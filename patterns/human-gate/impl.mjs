import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";

const client = new Anthropic();

// Opus 5.5 always thinks, so find the text block by type. Anything but end_turn
// (refusal, max_tokens) is not a usable answer; a refusal gets its own type so
// the pipeline can halt at the gate instead of crashing.
class RefusalError extends Error {}

function readText(response) {
  if (response.stop_reason === "refusal") throw new RefusalError("request refused by safety classifier");
  if (response.stop_reason !== "end_turn") throw new Error(`no usable answer (stop_reason: ${response.stop_reason})`);
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

async function runAgent(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it
    output_config: { effort: "medium" }, // explicit: defaults differ between models
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
  let solution;
  try {
    solution = await runAgent(
      "You are a coding agent. Produce a complete solution ready for human review.",
      task
    );
  } catch (err) {
    // A refusal still ends at the gate: halt, report, take no action.
    if (!(err instanceof RefusalError)) throw err;
    console.log(`\n✗ ${err.message} — nothing to review. Pipeline halted. No action taken.`);
    return { approved: false, reason: err.message };
  }

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
console.log("\nOutcome:", result.approved ? "Merged" : `Halted${result.reason ? ` (${result.reason})` : ""}`);
