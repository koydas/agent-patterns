import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";

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

function askHuman(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function irreversibleAction(solution) {
  // Simulates a merge, deploy, or other action that cannot be undone.
  console.log("[action] Executing merge...");
  await runAgent(
    "You are a merge agent. Confirm the merge was successful in one sentence.",
    `Merge this solution:\n${solution}`
  );
  console.log("[action] Merge complete.");
}

async function humanGatePipeline(task) {
  console.log("Running autonomous pipeline...");
  const solution = await runAgent(
    "You are a coding agent. Produce a complete solution ready for human review.",
    task
  );

  console.log("\n=== CANDIDATE OUTPUT ===\n");
  console.log(solution);
  console.log("\n=== HUMAN GATE ===");
  console.log("Review the output above. This is the last step before an irreversible action.");

  // The system stops here. It does NOT proceed on timeout or missing input.
  const answer = await askHuman("Approve and merge? [yes/no]: ");

  if (answer !== "yes") {
    console.log("\n✗ Not approved — pipeline halted. No action taken.");
    return { approved: false };
  }

  await irreversibleAction(solution);
  console.log("\n✓ Done.");
  return { approved: true };
}

const result = await humanGatePipeline(
  "Write a SQL migration that adds a `last_login` timestamp column to the `users` table"
);
console.log("\nOutcome:", result.approved ? "Merged" : "Halted");
