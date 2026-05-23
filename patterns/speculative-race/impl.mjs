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

const STRATEGIES = [
  {
    name: "minimal-fix",
    systemPrompt:
      "You are a conservative engineer. Produce the smallest possible change that solves the problem. No refactoring, no extras — just the fix.",
  },
  {
    name: "robust-fix",
    systemPrompt:
      "You are a thorough engineer. Produce a complete solution with input validation, error handling, and edge case coverage.",
  },
  {
    name: "refactor-fix",
    systemPrompt:
      "You are a clean-code engineer. Solve the problem and improve the surrounding code quality at the same time. Readability matters.",
  },
];

async function speculativeRace(task) {
  console.log(`\nLaunching ${STRATEGIES.length} strategies in parallel...\n`);

  const results = await Promise.all(
    STRATEGIES.map(({ name, systemPrompt }) =>
      runAgent(systemPrompt, `Task: ${task}`).then((output) => {
        console.log(`[${name}] Done.`);
        return { name, output };
      })
    )
  );

  const candidates = results
    .map(({ name, output }) => `### ${name}\n${output}`)
    .join("\n\n");

  console.log("\n[selector] Picking the best candidate...");
  const selection = await runAgent(
    "You are a senior engineer selecting the best solution from several candidates. On the first line, write exactly the strategy name you choose (e.g. 'minimal-fix'). Then briefly justify the choice in 1–2 sentences.",
    `Task: ${task}\n\nCandidates:\n${candidates}`
  );

  const winnerName = selection.split("\n")[0].trim();
  const winner = results.find(({ name }) => name === winnerName) ?? results[0];

  console.log(`[selector] Chose: ${winner.name}`);

  return { results, selection, winner };
}

const { winner, selection } = await speculativeRace(
  "Users are logged out after 5 minutes of inactivity even when they are actively filling a long form"
);

console.log("\n=== SELECTION RATIONALE ===\n");
console.log(selection);
console.log("\n=== WINNING IMPLEMENTATION ===\n");
console.log(winner.output);
