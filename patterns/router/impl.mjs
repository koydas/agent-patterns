import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text;
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
