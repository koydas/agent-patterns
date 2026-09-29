/**
 * ac-traceability — minimal simulation
 *
 * Builder produces a patch + AC coverage block.
 * Reviewer validates the block without re-reading the diff.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Opus 5.5 always thinks, so the text block isn't necessarily content[0].
// Check stop_reason first: a refusal or a truncation is not an answer.
function readText(response) {
  if (response.stop_reason === "refusal") throw new Error("request refused by safety classifier");
  if (response.stop_reason === "max_tokens") throw new Error("output truncated at max_tokens");
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error(`no text in response (stop_reason: ${response.stop_reason})`);
  return block.text;
}

async function runAgent(system, user) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it — leave room for thinking + reply
    output_config: { effort: "medium" }, // set explicitly: defaults change between models
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a safety-classifier refusal is retried on a recommended model
    system,
    messages: [{ role: "user", content: user }],
  });
  return readText(response);
}

// --- Builder: produces patch + AC coverage block ---

async function builder(brief) {
  console.log("[builder] Implementing...");

  const output = await runAgent(
    `You are a feature implementation agent.
Given a brief with acceptance criteria, produce:
1. A short patch description (2-3 lines of pseudocode)
2. An AC coverage block — one line per AC item in this exact format:
   [x] <AC text> — covered by <file>:<line>
   [ ] <AC text> — blocked: <reason>
Every AC item must appear. Checked items MUST include a file:line reference.`,
    `Brief:\n${brief}`
  );

  return output;
}

// --- Reviewer: validates AC block, does not re-read diff ---

async function reviewer(patchAndAC) {
  console.log("[reviewer] Validating AC coverage block...");

  const verdict = await runAgent(
    `You are a code reviewer checking AC coverage.
You receive a builder output that contains a patch description and an AC coverage block.
Rules:
- Every [ ] item MUST have a "blocked: <reason>" justification. If any [ ] item lacks a reason, output NEEDS_REVIEW with the offending items.
- Every [x] item MUST have a "covered by file:line" reference. If any [x] item lacks a reference, output NEEDS_REVIEW.
- If all items satisfy the rules, output DONE.
Output format:
Status: DONE | NEEDS_REVIEW
Issues: <list uncovered items, or "none">`,
    `Builder output:\n${patchAndAC}`
  );

  return verdict;
}

// --- Run ---

const brief = `
Feature: User profile editing

Acceptance criteria:
1. User can update display name (max 50 chars)
2. User can update avatar URL (must be https)
3. Changes are persisted to the database
4. Invalid inputs return a 400 error with a message
`;

const builderOutput = await builder(brief);
console.log("\n--- Builder output ---\n", builderOutput);

const reviewVerdict = await reviewer(builderOutput);
console.log("\n--- Reviewer verdict ---\n", reviewVerdict);
