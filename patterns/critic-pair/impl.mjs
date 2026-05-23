import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text;
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
