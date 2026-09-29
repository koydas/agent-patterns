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

const SPECIALISTS = {
  BUG_FIX:
    "You are a bug-fix specialist. Diagnose the root cause and produce a minimal, targeted fix. Do not refactor surrounding code.",
  FEATURE:
    "You are a feature implementation specialist. Implement the requested functionality cleanly, following the existing code style.",
  REFACTOR:
    "You are a refactoring specialist. Improve code structure and readability without changing observable behavior.",
  SECURITY:
    "You are a security specialist. Identify vulnerabilities and produce a hardened fix with no functional regressions.",
};

async function router(task) {
  console.log("\n[router] Classifying task...");

  const category = await runAgent(
    "You are a task router for a software development pipeline. Classify the task into exactly one of: BUG_FIX, FEATURE, REFACTOR, SECURITY. Reply with only the category name, nothing else.",
    `Task: ${task}`
  );

  const normalized = category.trim().toUpperCase();
  const systemPrompt = SPECIALISTS[normalized] ?? SPECIALISTS.FEATURE;

  if (!SPECIALISTS[normalized]) {
    console.log(`[router] Unknown category '${normalized}', defaulting to FEATURE.`);
  }

  console.log(`[router] Category: ${normalized}`);
  console.log(`[router] Dispatching to ${normalized} specialist...`);

  const result = await runAgent(systemPrompt, `Task: ${task}`);
  console.log(`[${normalized.toLowerCase()}]`, result.slice(0, 120).replace(/\n/g, " ") + "...");

  return { category: normalized, result };
}

const { category, result } = await router(
  "The login function returns undefined when the password contains special characters like @ or #"
);

console.log(`\n=== RESULT (${category}) ===\n`);
console.log(result);
