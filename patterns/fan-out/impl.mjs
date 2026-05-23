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

async function fanOut(task, subtasks) {
  console.log(`\nFanning out to ${subtasks.length} workers in parallel...`);

  const results = await Promise.all(
    subtasks.map(({ name, systemPrompt }) =>
      runAgent(systemPrompt, `Task: ${task}`).then((output) => {
        console.log(`[${name}] Done.`);
        return { name, output };
      })
    )
  );

  console.log("\n[aggregator] Merging results...");
  const combined = results
    .map(({ name, output }) => `### ${name}\n${output}`)
    .join("\n\n");

  const summary = await runAgent(
    "You are an aggregator. You receive reports from multiple specialist agents. Synthesize them into a single, concise verdict.",
    `${combined}\n\nTask: ${task}`
  );

  console.log("[aggregator] Done.");
  return { results, summary };
}

const { summary } = await fanOut(
  "Review this function: function add(a, b) { return a - b; }",
  [
    {
      name: "correctness-reviewer",
      systemPrompt: "You are a correctness reviewer. Identify logical bugs only.",
    },
    {
      name: "style-reviewer",
      systemPrompt: "You are a style reviewer. Identify naming and readability issues only.",
    },
    {
      name: "security-reviewer",
      systemPrompt: "You are a security reviewer. Identify security issues only.",
    },
  ]
);

console.log("\n=== AGGREGATED VERDICT ===\n");
console.log(summary);
