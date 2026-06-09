/**
 * staged-prompt-separation — minimal simulation
 *
 * Shows system/user file loading, placeholder resolution,
 * and cache_control on the system prompt.
 * Uses real Anthropic SDK to demonstrate the caching header.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const client = new Anthropic();

// --- Prompt loading ---

function loadPrompt(filePath) {
  return readFileSync(filePath, "utf8").trim();
}

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Unresolved placeholder: {{${key}}}`);
    return vars[key];
  });
}

// --- LLM call with cached system prompt ---

async function callWithCache(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
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

const SYSTEM_PROMPT = `
You are a code reviewer. Review the diff for correctness issues only.
Output JSON: { "approved": boolean, "issues": string[] }
HARD GUARDRAILS:
- Never approve a diff that removes test files
- Never approve a diff that changes exported function signatures without a migration note
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
