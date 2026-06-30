/**
 * typed-evidence-chain — minimal simulation
 *
 * Router dispatches to type-specific builders.
 * Each builder appends a different evidence block.
 * Reviewer applies type-specific validation.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runAgent(system, user) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content[0].text;
}

// --- Router ---

async function router(task) {
  const type = await runAgent(
    "Classify the task as exactly one of: BUG, REFACTOR, FEATURE. Reply with only the word.",
    task
  );
  return type.trim().toUpperCase();
}

// --- Builders ---

const BUILDERS = {
  BUG: async (task) =>
    runAgent(
      `You are a bug-fix specialist.
Produce:
1. Patch: a minimal fix description
2. AC coverage: [x] or [ ] items with file:line
3. Reproduction block: a test or steps that reproduce the defect BEFORE the fix
   Format: "Reproduction: <test name or steps>"`,
      task
    ),

  REFACTOR: async (task) =>
    runAgent(
      `You are a refactor specialist.
Produce:
1. Patch: what was restructured and why
2. AC coverage: [x] or [ ] items with file:line
3. Non-regression evidence: confirm which pre-existing tests cover the changed code
   Format: "Non-regression: <test names or 'no tests exist'>"`,
      task
    ),

  FEATURE: async (task) =>
    runAgent(
      `You are a feature implementation specialist.
Produce:
1. Patch: what was added
2. AC coverage: [x] or [ ] items with file:line
No additional evidence block required — AC coverage is sufficient.`,
      task
    ),
};

// --- Reviewer ---

const REVIEWER_RULES = {
  BUG: "Check: (1) Does the reproduction block describe pre-fix behavior? (2) Does the fix address exactly what the reproduction shows? Flag NEEDS_REVIEW if reproduction is missing or unrelated to the fix.",
  REFACTOR: "Check: (1) Does non-regression evidence list tests that cover the changed code? (2) If no tests exist, flag NEEDS_REVIEW — refactors without test coverage are unsafe.",
  FEATURE: "Check: (1) Is every AC item checked with a file:line reference? (2) Are unchecked items justified? Flag NEEDS_REVIEW if any item is unchecked without reason.",
};

async function reviewer(type, builderOutput) {
  const rules = REVIEWER_RULES[type] ?? REVIEWER_RULES.FEATURE;
  return runAgent(
    `You are a code reviewer. Type-specific validation rules:\n${rules}\n\nOutput: "Status: DONE" or "Status: NEEDS_REVIEW\nIssues: <list>"`,
    `Change type: ${type}\n\nBuilder output:\n${builderOutput}`
  );
}

// --- Run ---

const task =
  "The login function returns undefined when the password contains @ or # characters. Users cannot log in.";

console.log("[router] Classifying...");
const type = await router(task);
console.log(`[router] Type: ${type}`);

const builderFn = BUILDERS[type] ?? BUILDERS.FEATURE;
console.log(`[${type.toLowerCase()}-builder] Building...`);
const builderOutput = await builderFn(task);
console.log("\n--- Builder output ---\n", builderOutput);

console.log("\n[reviewer] Reviewing with type-specific rules...");
const verdict = await reviewer(type, builderOutput);
console.log("\n--- Reviewer verdict ---\n", verdict);
