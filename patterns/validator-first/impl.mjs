import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Opus 5.5 always thinks, so find the text block by type. Anything but end_turn
// (refusal, max_tokens) is not a usable answer.
function readText(response) {
  if (response.stop_reason !== "end_turn") throw new Error(`no usable answer (stop_reason: ${response.stop_reason})`);
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

// Effort is a per-role decision: a gate or classifier runs cheap and fast,
// the agents behind it get the budget.
async function runAgent(systemPrompt, userPrompt, { effort = "medium", maxTokens = 16000 } = {}) {
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: maxTokens, // thinking counts toward it
    output_config: { effort },
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return readText(response);
}

async function validate(issue) {
  const result = await runAgent(
    "You are a validation agent. Check if the issue is specific enough to act on. " +
      "Start your response with exactly VALID or NEEDS_REFINEMENT, then give a one-sentence reason.",
    `Issue: ${issue}`,
    { effort: "low", maxTokens: 4000 } // the gate runs on every request: keep it cheap and fast
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
