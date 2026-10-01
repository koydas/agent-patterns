import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";

const client = new Anthropic();

// Opus 5.5 always thinks, so find the text block by type. Anything but end_turn
// (refusal, max_tokens) is not a usable answer.
function readText(response) {
  if (response.stop_reason !== "end_turn") throw new Error(`no usable answer (stop_reason: ${response.stop_reason})`);
  return response.content.find((b) => b.type === "text")?.text ?? "";
}
const CHECKPOINT_FILE = "./checkpoint.json";
const CHECKPOINT_TMP = "./checkpoint.json.tmp";

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

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return { step: 0, state: {} };
  return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
}

// Atomic write: write to tmp then rename to avoid corrupt checkpoints on crash.
function saveCheckpoint(step, state) {
  writeFileSync(CHECKPOINT_TMP, JSON.stringify({ step, state }, null, 2));
  renameSync(CHECKPOINT_TMP, CHECKPOINT_FILE);
}

function clearCheckpoint() {
  saveCheckpoint(0, {});
}

const STEPS = [
  {
    name: "analyze",
    run: async (task, state) => {
      const analysis = await runAgent(
        "You are a task analyst. Break down the task into clear, numbered requirements.",
        `Task: ${task}`
      );
      return { ...state, analysis };
    },
  },
  {
    name: "plan",
    run: async (task, state) => {
      const plan = await runAgent(
        "You are a software architect. Produce a concise step-by-step implementation plan.",
        `Task: ${task}\n\nRequirements:\n${state.analysis}`
      );
      return { ...state, plan };
    },
  },
  {
    name: "implement",
    run: async (task, state) => {
      const code = await runAgent(
        "You are a developer. Implement the solution following the plan exactly. Output only code.",
        `Task: ${task}\n\nPlan:\n${state.plan}`
      );
      return { ...state, code };
    },
  },
];

async function checkpointResume(task) {
  let { step: startStep, state } = loadCheckpoint();

  if (startStep > 0) {
    console.log(`\nResuming from step ${startStep + 1} (${STEPS[startStep]?.name ?? "done"})...`);
  }

  for (let i = startStep; i < STEPS.length; i++) {
    const { name, run } = STEPS[i];
    console.log(`\n[step ${i + 1}/${STEPS.length}] ${name}...`);
    state = await run(task, state);
    saveCheckpoint(i + 1, state);
    console.log(`[checkpoint] Saved after '${name}'.`);
  }

  clearCheckpoint();
  return state;
}

const result = await checkpointResume(
  "Add rate limiting to the /api/login endpoint to block brute-force attacks after 5 failed attempts"
);

console.log("\n=== IMPLEMENTATION ===\n");
console.log(result.code);
