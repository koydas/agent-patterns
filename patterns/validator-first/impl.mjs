import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text;
}

async function validate(issue) {
  const result = await runAgent(
    "You are a validation agent. Check if the issue is specific enough to act on. " +
      "Start your response with exactly VALID or NEEDS_REFINEMENT, then give a one-sentence reason.",
    `Issue: ${issue}`
  );
  return { valid: result.startsWith("VALID"), reason: result };
}

async function mainPipeline(issue) {
  return runAgent(
    "You are a coding agent. Implement the requested feature.",
    `Issue: ${issue}`
  );
}

async function validatorFirst(issue) {
  console.log(`\nIssue: "${issue}"`);

  const validation = await validate(issue);
  console.log("[validator]", validation.reason.slice(0, 120));

  if (!validation.valid) {
    console.log("✗ Blocked — label: needs-refinement");
    return { blocked: true, label: "needs-refinement", reason: validation.reason };
  }

  console.log("✓ Valid — running pipeline");
  const output = await mainPipeline(issue);
  console.log("[pipeline] Done.");
  return { blocked: false, output };
}

// Well-specified issue
const r1 = await validatorFirst(
  "Add a submit button to the login form that calls POST /api/login with email and password"
);
console.log("Outcome:", r1.blocked ? `Blocked (${r1.label})` : "Completed");

// Under-specified issue
const r2 = await validatorFirst("Fix the bug");
console.log("Outcome:", r2.blocked ? `Blocked (${r2.label})` : "Completed");
