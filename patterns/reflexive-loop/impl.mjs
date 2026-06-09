import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const CLAUDE_MD_PATH = process.env.CLAUDE_MD_PATH ?? "./CLAUDE.md";

async function runAgent(system, user) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content[0].text;
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
