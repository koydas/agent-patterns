import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
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
const CLAUDE_MD_PATH = process.env.CLAUDE_MD_PATH ?? "./CLAUDE.md";

async function runAgent(system, user) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000, // thinking counts toward it — leave room for thinking + reply
    output_config: { effort: "medium" }, // set explicitly: defaults change between models
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a safety-classifier refusal is retried on a recommended model
    system,
    messages: [{ role: "user", content: user }],
  });
  return readText(response);
}

function loadInstructions() {
  return existsSync(CLAUDE_MD_PATH) ? readFileSync(CLAUDE_MD_PATH, "utf8") : "";
}

function persistRules(rules) {
  const existing = loadInstructions();
  const timestamp = new Date().toISOString().slice(0, 10);
  const block = `\n## Learned rules (${timestamp})\n\n${rules}\n`;
  writeFileSync(CLAUDE_MD_PATH, existing + block, "utf8");
}

async function pipelineRun(task) {
  const instructions = loadInstructions();
  const output = await runAgent(
    `You are a coding agent.${instructions ? `\n\nActive instructions:\n${instructions}` : ""}`,
    `Task: ${task}`
  );
  console.log("[pipeline output]\n", output.slice(0, 300));
  return output;
}

async function learnFromFeedback(output, feedback) {
  return runAgent(
    "You are a rules extraction agent. Given an agent output and human feedback, extract 1-3 concise, actionable rules in imperative form (e.g. 'Always X', 'Never Y', 'When Z, do W'). Output only the rules as a markdown list — no preamble.",
    `Agent output:\n${output}\n\nHuman feedback:\n${feedback}`
  );
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

// --- run ---
const task = "Write a function that validates an email address.";

console.log("=== Run 1 (cold) ===");
const output = await pipelineRun(task);

const feedback = await prompt("\nFeedback (or press Enter to skip): ");

if (feedback.trim()) {
  const rules = await learnFromFeedback(output, feedback);
  console.log("\n[learn agent] extracted rules:\n", rules);
  persistRules(rules);
  console.log(`\n[persist] rules written to ${CLAUDE_MD_PATH}`);

  console.log("\n=== Run 2 (with learned rules) ===");
  await pipelineRun(task);
} else {
  console.log("No feedback — skipping learn step.");
}
