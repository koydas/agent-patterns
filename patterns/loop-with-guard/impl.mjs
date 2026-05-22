import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MAX_ROUNDS = 5;

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text;
}

async function loopWithGuard(task) {
  let code = "";
  let feedback = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n--- Round ${round}/${MAX_ROUNDS} ---`);

    code = await runAgent(
      "You are a coding agent. Write or improve code based on the task and any reviewer feedback.",
      `Task: ${task}\n\nPrevious code:\n${code}\n\nReviewer feedback:\n${feedback}`
    );
    console.log("[coder]", code.slice(0, 120).replace(/\n/g, " ") + "...");

    const review = await runAgent(
      "You are a code reviewer. Start your response with exactly APPROVED or CHANGES_REQUESTED, then explain.",
      `Review this code:\n\n${code}`
    );
    console.log("[reviewer]", review.slice(0, 120).replace(/\n/g, " ") + "...");

    if (review.startsWith("APPROVED")) {
      console.log(`\n✓ Approved after ${round} round(s).`);
      return { code, rounds: round, escalated: false };
    }

    feedback = review;
  }

  console.log(`\n⚠ Round cap reached (${MAX_ROUNDS}) — escalating to human gate.`);
  return { code, rounds: MAX_ROUNDS, escalated: true };
}

const result = await loopWithGuard("Write a function that reverses a string");
console.log("\nOutcome:", result.escalated ? "Escalated" : `Approved in ${result.rounds} round(s)`);
