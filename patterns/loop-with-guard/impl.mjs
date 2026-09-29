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

// Strict: the response must be a JSON object with a known verdict. The only
// leniency is one surrounding ```json fence; prose or missing fields still fail.
function parseReview(text) {
  const unfenced = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, "$1");
  const parsed = JSON.parse(unfenced);
  if (parsed.verdict !== "APPROVED" && parsed.verdict !== "CHANGES_REQUESTED") {
    throw new Error(`unknown verdict: ${JSON.stringify(parsed.verdict)}`);
  }
  if (!Array.isArray(parsed.reasons) || !parsed.reasons.every((r) => typeof r === "string")) {
    throw new Error("reasons must be an array of strings");
  }
  return parsed;
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

    const raw = await runAgent(
      "You are a code reviewer. Check the code against the task. Respond with only a JSON object, " +
        'no markdown fences: {"verdict": "APPROVED" | "CHANGES_REQUESTED", "reasons": string[]}',
      `Task: ${task}\n\nReview this code:\n\n${code}`
    );

    let review;
    try {
      review = parseReview(raw);
    } catch (err) {
      // Fail closed: an unparseable review never approves. Keep the previous
      // feedback so the coder isn't steered by a parse error it can't act on.
      console.log(`[reviewer] unparseable output (${err.message}) — treating as CHANGES_REQUESTED`);
      continue;
    }
    console.log(`[reviewer] ${review.verdict}: ${review.reasons.join("; ").slice(0, 120)}`);

    if (review.verdict === "APPROVED") {
      console.log(`\n✓ Approved after ${round} round(s).`);
      return { code, rounds: round, escalated: false };
    }

    feedback = review.reasons.map((r) => `- ${r}`).join("\n");
  }

  console.log(`\n⚠ Round cap reached (${MAX_ROUNDS}) — escalating to human gate.`);
  return { code, rounds: MAX_ROUNDS, escalated: true };
}

const result = await loopWithGuard("Write a function that reverses a string");
console.log("\nOutcome:", result.escalated ? "Escalated" : `Approved in ${result.rounds} round(s)`);
