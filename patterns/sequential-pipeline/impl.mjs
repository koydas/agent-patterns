import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Opus 5.5 always thinks, so find the text block by type. Anything but end_turn
// (refusal, max_tokens) is not a usable answer.
function readText(response) {
  if (response.stop_reason !== "end_turn") throw new Error(`no usable answer (stop_reason: ${response.stop_reason})`);
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

async function runAgent(name, systemPrompt, userPrompt) {
  console.log(`\n[${name}] Running...`);
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it
    output_config: { effort: "medium" }, // explicit: defaults differ between models
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  // A refusal maps onto the handoff contract: the stage is BLOCKED and the pipeline halts.
  if (response.stop_reason === "refusal") {
    console.log(`[${name}] Refused.`);
    return "### Status\nBLOCKED\n### Handoff\nRequest refused by safety classifier.";
  }
  const output = readText(response);
  console.log(`[${name}] Done.`);
  return output;
}

function parseHandoff(output) {
  const match = output.match(/###\s*Handoff\s*\n([\s\S]*?)(?=###|$)/i);
  return match ? match[1].trim() : output;
}

function isBlocked(output) {
  return /###\s*Status\s*\nBLOCKED/i.test(output);
}

async function sequentialPipeline(issue) {
  const handoffContract =
    "End your response with:\n### Status\n[READY|BLOCKED]\n### Handoff\n[structured summary for the next agent]";

  const analysis = await runAgent(
    "ticket-analyst",
    `You are a ticket analyst. Break down the issue into a clear implementation plan. ${handoffContract}`,
    `Issue: ${issue}`
  );
  if (isBlocked(analysis)) return { stage: "ticket-analyst", blocked: true, reason: parseHandoff(analysis) };

  const code = await runAgent(
    "code-builder",
    `You are a coding agent. Implement the plan provided. ${handoffContract}`,
    `Plan:\n${parseHandoff(analysis)}`
  );
  if (isBlocked(code)) return { stage: "code-builder", blocked: true, reason: parseHandoff(code) };

  const review = await runAgent(
    "code-reviewer",
    "You are a code reviewer. Review the implementation.\n" +
      "End with:\n### Status\n[APPROVED|CHANGES_REQUESTED]\n### Handoff\n[verdict and summary]",
    `Implementation:\n${parseHandoff(code)}`
  );

  if (isBlocked(review)) return { stage: "code-reviewer", blocked: true, reason: parseHandoff(review) };

  const approved = /###\s*Status\s*\nAPPROVED/i.test(review);
  return { stage: "code-reviewer", blocked: false, approved, output: review };
}

const result = await sequentialPipeline(
  "Add input validation to the user registration form: email format and password minimum 8 chars"
);

if (result.blocked) {
  console.log(`\nPipeline halted at stage: ${result.stage} — ${result.reason}`);
} else {
  console.log(`\nPipeline complete — ${result.approved ? "APPROVED" : "CHANGES_REQUESTED"}`);
}
