import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";

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
