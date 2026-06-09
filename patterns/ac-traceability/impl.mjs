/**
 * ac-traceability — minimal simulation
 *
 * Builder produces a patch + AC coverage block.
 * Reviewer validates the block without re-reading the diff.
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
