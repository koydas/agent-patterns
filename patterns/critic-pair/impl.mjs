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

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it — leave room for thinking + reply
    output_config: { effort: "medium" }, // set explicitly: defaults change between models
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a safety-classifier refusal is retried on a recommended model
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return readText(response);
}

async function criticPair(task) {
  console.log("\n[proposer] Generating proposal...");
  const proposal = await runAgent(
    "You are a software engineer. Produce a clean, working implementation for the given task.",
    `Task: ${task}`
  );
  console.log("[proposer]", proposal.slice(0, 120).replace(/\n/g, " ") + "...");

  console.log("\n[challenger] Challenging proposal...");
  const critique = await runAgent(
    "You are an adversarial code reviewer. Your job is to find every flaw in the proposal: bugs, security vulnerabilities, unhandled edge cases, performance issues. Be specific. Do not suggest improvements — only identify problems.",
    `Original task: ${task}\n\nProposal to challenge:\n${proposal}`
  );
  console.log("[challenger]", critique.slice(0, 120).replace(/\n/g, " ") + "...");

  console.log("\n[judge] Evaluating...");
  const verdict = await runAgent(
    "You are a senior engineer acting as judge. Given a proposal and an adversarial critique, decide: respond with ACCEPTED or REJECTED on the first line. If ACCEPTED, briefly explain why the proposal holds despite the critique. If REJECTED, list only the critical blocking issues.",
    `Task: ${task}\n\nProposal:\n${proposal}\n\nCritique:\n${critique}`
  );

  const accepted = verdict.trimStart().startsWith("ACCEPTED");
  console.log(`[judge] ${accepted ? "ACCEPTED" : "REJECTED"}`);

  return { proposal, critique, verdict, accepted };
}

const { proposal, critique, verdict, accepted } = await criticPair(
  "Write a function that parses a JWT token and returns the payload without using any external library"
);

console.log("\n=== VERDICT ===\n");
console.log(verdict);
if (!accepted) {
  console.log("\n=== CRITIQUE ===\n");
  console.log(critique);
}
