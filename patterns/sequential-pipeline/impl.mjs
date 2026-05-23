import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runAgent(name, systemPrompt, userPrompt) {
  console.log(`\n[${name}] Running...`);
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const output = response.content[0].text;
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
