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

async function runAgent(name, systemPrompt, userPrompt) {
  console.log(`\n[${name}] Running...`);
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it — leave room for thinking + reply
    output_config: { effort: "medium" }, // set explicitly: defaults change between models
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a safety-classifier refusal is retried on a recommended model
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
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
  if (isBlocked(analysis)) return { stage: "ticket-analyst", blocked: true };

  const code = await runAgent(
    "code-builder",
    `You are a coding agent. Implement the plan provided. ${handoffContract}`,
    `Plan:\n${parseHandoff(analysis)}`
  );
  if (isBlocked(code)) return { stage: "code-builder", blocked: true };

  const review = await runAgent(
    "code-reviewer",
    "You are a code reviewer. Review the implementation.\n" +
      "End with:\n### Status\n[APPROVED|CHANGES_REQUESTED]\n### Handoff\n[verdict and summary]",
    `Implementation:\n${parseHandoff(code)}`
  );

  const approved = /###\s*Status\s*\nAPPROVED/i.test(review);
  return { stage: "code-reviewer", blocked: false, approved, output: review };
}

const result = await sequentialPipeline(
  "Add input validation to the user registration form: email format and password minimum 8 chars"
);

if (result.blocked) {
  console.log(`\nPipeline halted at stage: ${result.stage}`);
} else {
  console.log(`\nPipeline complete — ${result.approved ? "APPROVED" : "CHANGES_REQUESTED"}`);
}
