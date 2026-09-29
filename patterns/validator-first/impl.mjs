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
