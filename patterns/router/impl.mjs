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
    `Task: ${task}`,
    { effort: "low", maxTokens: 4000 } // classification: one word out, no need for deep thinking
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
