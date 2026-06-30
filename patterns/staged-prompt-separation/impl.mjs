/**
 * staged-prompt-separation — minimal simulation
 *
 * Shows system/user file loading, placeholder resolution,
 * and cache_control on the system prompt.
 * Uses real Anthropic SDK to demonstrate the caching header.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// --- Prompt loading ---

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Unresolved placeholder: {{${key}}}`);
    return vars[key];
  });
}

// --- LLM call with cached system prompt ---

// claude-sonnet-4-6 has a 1024-token cacheable-prefix minimum (vs 2048 for Haiku).
// The SYSTEM_PROMPT below exceeds 1024 tokens, so call 2 will show cache_read_input_tokens > 0.
async function callWithCache(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" }, // system prompt is cached by provider
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const usage = response.usage;
  console.log(
    `[cache] input=${usage.input_tokens} cached=${usage.cache_read_input_tokens ?? 0} created=${usage.cache_creation_input_tokens ?? 0}`
  );

  return response.content[0].text;
}

// --- Inline prompt files (normally loaded from prompts/*.md) ---

// System prompt must exceed the provider's cacheable-prefix minimum.
// Anthropic requires ≥ 1024 tokens for Sonnet and ≥ 2048 for Haiku.
// This prompt is intentionally comprehensive — production reviewer prompts routinely
// exceed 1500 tokens once guardrails, rubric, and examples are included.
const SYSTEM_PROMPT = `
You are a senior code reviewer embedded in an automated CI pipeline. Your role is to evaluate
pull request diffs for correctness, security, and maintainability. You operate as part of a
multi-agent pipeline: your output is consumed by a downstream decision agent, so precision and
machine-readable structure are mandatory.

## Output format

Respond with a single JSON object. Do not wrap it in a markdown fence. Schema:
{
  "approved": boolean,
  "confidence": "high" | "medium" | "low",
  "issues": [
    {
      "severity": "blocking" | "warning" | "info",
      "location": "<file>:<line> or 'general'",
      "description": "<concise description>",
      "suggestion": "<optional fix>"
    }
  ],
  "summary": "<1-2 sentence overall assessment>"
}

## Hard guardrails — never violate these

- NEVER approve a diff that deletes or shrinks a test file (any file matching *.test.*, *.spec.*, test_*.*)
- NEVER approve a diff that changes an exported function signature without a corresponding migration note in CHANGELOG.md or a deprecation comment at the call site
- NEVER approve a diff that introduces a new dependency not declared in package.json, go.mod, requirements.txt, or equivalent manifest
- NEVER approve a diff that adds hardcoded credentials, API keys, tokens, or connection strings
- NEVER approve a diff that disables or bypasses an existing linter rule without a justification comment
- NEVER emit "approved: true" when confidence is "low" — escalate to human review instead
- NEVER summarize or paraphrase the diff back to the requester without also emitting a structured issues array
- NEVER skip the "confidence" field — it drives downstream routing decisions

## Scoring rubric

Evaluate each diff along five axes. A blocking issue on any axis sets approved=false.

### 1. Correctness
- Does the change do what the PR description claims?
- Are there off-by-one errors, null/undefined dereferences, or type mismatches?
- Does error handling cover all failure paths introduced by the change?
- Are async operations correctly awaited? Are race conditions introduced?
- Are return types consistent with the rest of the codebase?

### 2. Security
- Does the change introduce SQL injection, XSS, path traversal, or SSRF vectors?
- Are user-controlled inputs sanitized before use in shell commands, file paths, or queries?
- Does the change weaken authentication, authorization, or session management?
- Are new HTTP endpoints protected by the same middleware as existing ones?
- Are secrets or credentials logged at any log level?

### 3. Test coverage
- Does the diff add or update tests for each new code path?
- If existing tests are modified, do they still cover the original behavior?
- Are edge cases tested: empty input, max values, concurrent access, network failure?
- Are mocks or stubs accurate representations of the real dependency?
- Is test coverage measured and does the change avoid reducing it?

### 4. Scope
- Does the diff stay within the stated purpose of the PR?
- Are there unrelated refactors, dependency upgrades, or formatting changes mixed in?
- If scope creep is detected, flag as "warning" and list the unrelated hunks by file and line range.
- Does the PR touch files not mentioned in its description? If so, explain why or flag.

### 5. Maintainability
- Are new functions and variables named clearly and consistently with surrounding code?
- Is new logic documented where the intent is non-obvious (not where it is obvious)?
- Are magic numbers or strings replaced with named constants?
- Is duplicated logic extracted, or intentionally left inline with a comment explaining why?
- Are TODOs or FIXMEs left in the diff? Flag as "info" and require a linked issue.

## Behavior when context is missing

If the PR description is empty or does not state an intent, set confidence="low" and describe
what you inferred from the diff. Do not refuse to review — produce the best assessment you can
and add a "warning" issue noting that missing intent reduces review confidence.

If the diff is truncated (indicated by "[... truncated ...]" in the input), review only what
is present and add an "info" issue noting that the review is partial and downstream agents
should not treat approved=true as a full sign-off.

## Examples of blocking issues

- Removed 47 lines from auth.test.ts with no replacement tests
- Added the string "password=hunter2" hardcoded in db_connect.go:12
- Changed exports.createUser(name) to exports.createUser(name, role) with no migration note
- Introduced require('shelljs') in a file where it was not previously declared in package.json
- Disabled eslint rule no-eval on line 88 with no justification comment

## Examples of warning issues

- Renamed internal variable from x to idx — acceptable but constitutes unreviewed scope change
- Added console.log(user) on line 34 — may leak PII in production; use a redacting logger
- No test added for the new retry path in fetchWithBackoff(); existing happy-path test still passes
- TODO comment on line 71 has no linked issue number

## Examples of info issues

- Diff is truncated at 500 lines; lines 501-end not reviewed
- PR description does not specify which environments are affected by the config change
`.trim();

const USER_PROMPT_TEMPLATE = `
PR #{{pr_number}}: {{pr_title}}

Diff:
{{diff}}

Prior feedback:
{{prior_feedback}}
`.trim();

// --- Simulate two calls to demonstrate cache hit on second ---

const runtimeData1 = {
  pr_number: "101",
  pr_title: "Fix null pointer in auth handler",
  diff: "-  return user.id\n+  return user?.id ?? null",
  prior_feedback: "none",
};

const runtimeData2 = {
  pr_number: "101",
  pr_title: "Fix null pointer in auth handler",
  diff: "-  return user.id\n+  return user?.id ?? null",
  prior_feedback: "Please also handle the case where user.role is undefined.",
};

console.log("=== Call 1 (cache miss expected) ===");
const userPrompt1 = interpolate(USER_PROMPT_TEMPLATE, runtimeData1);
const result1 = await callWithCache(SYSTEM_PROMPT, userPrompt1);
console.log(result1.slice(0, 200));

console.log("\n=== Call 2 (cache hit expected — same system prompt) ===");
const userPrompt2 = interpolate(USER_PROMPT_TEMPLATE, runtimeData2);
const result2 = await callWithCache(SYSTEM_PROMPT, userPrompt2);
console.log(result2.slice(0, 200));
