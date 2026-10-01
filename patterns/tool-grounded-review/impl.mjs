import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const client = new Anthropic();
const MAX_TOOL_CALLS = 8;

// Declared checks — the model may pick among them (variant B) but never invents a command.
const CHECKS = { tests: ["npm", ["test"]], lint: ["npm", ["run", "lint"]] };

async function runCheck(repo, name) {
  const [cmd, args] = CHECKS[name];
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd: repo, timeout: 300_000 });
    return { name, status: "PASS", tail: (stdout + stderr).slice(-1500) };
  } catch (err) {
    const status = err.killed || typeof err.code !== "number" ? "UNVERIFIED" : "FAIL";
    return { name, status, tail: `${err.stdout ?? ""}${err.stderr ?? err.message}`.slice(-1500) };
  }
}

async function ask(params) {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: "You review code changes. End with exactly one line: VERDICT: APPROVED or VERDICT: REQUEST_CHANGES.",
    ...params,
  });
  if (response.stop_reason === "refusal") throw new Error("Reviewer declined the request");
  return response;
}

const textOf = (response) => response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

// Variant A — code runs every check, the model only judges.
async function reviewWithPushedEvidence(repo, diff) {
  const evidence = await Promise.all(Object.keys(CHECKS).map((name) => runCheck(repo, name)));
  const block = evidence.map((e) => `- ${e.name}: ${e.status}\n${e.status === "PASS" ? "" : e.tail}`).join("\n");
  const response = await ask({ messages: [{ role: "user", content: `Diff:\n${diff}\n\nTool evidence:\n${block}` }] });
  return { evidence, review: textOf(response) };
}

// Variant B — the model decides what to read and run, within MAX_TOOL_CALLS.
const TOOLS = [
  { name: "read_file", description: "Read a file of the repository under review.", strict: true,
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "run_check", description: "Run one declared repository check.", strict: true,
    input_schema: { type: "object", properties: { name: { type: "string", enum: Object.keys(CHECKS) } }, required: ["name"], additionalProperties: false } },
];

async function executeTool(repo, evidence, { name, input }) {
  if (name === "run_check") {
    const result = await runCheck(repo, input.name);
    evidence.push(result);
    return `${result.status}\n${result.tail}`;
  }
  const target = path.resolve(repo, input.path);
  if (!target.startsWith(path.resolve(repo) + path.sep)) throw new Error("path escapes the repository");
  return (await readFile(target, "utf8")).slice(0, 20_000);
}

async function reviewWithToolLoop(repo, diff) {
  const evidence = [];
  const messages = [{ role: "user", content: `Diff:\n${diff}\n\nInvestigate with the tools as needed, then give your verdict.` }];
  // Tools stay declared (history holds tool_use blocks); past the budget, calls are refused instead.
  for (let calls = 0, rounds = 0; ; rounds++) {
    const response = await ask({ tools: TOOLS, messages });
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((b) => b.type === "tool_use");
    const done = response.stop_reason !== "tool_use" || uses.length === 0;
    if (done || rounds > MAX_TOOL_CALLS) return { evidence, review: textOf(response) }; // no VERDICT line → not approved
    const results = [];
    for (const use of uses) {
      if (++calls > MAX_TOOL_CALLS) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: "Tool budget exhausted. Give your verdict now.", is_error: true });
        continue;
      }
      try {
        results.push({ type: "tool_result", tool_use_id: use.id, content: await executeTool(repo, evidence, use) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

// The gate lives in code: a failing check blocks approval whatever the model said.
function verdict({ evidence, review }) {
  const failing = evidence.filter((e) => e.status === "FAIL").map((e) => e.name);
  const llmApproved = /VERDICT:\s*APPROVED/.test(review);
  return { approved: llmApproved && failing.length === 0, overridden: llmApproved && failing.length > 0, failing };
}

const [repo = ".", flag] = process.argv.slice(2);
const { stdout: diff } = await run("git", ["diff", "HEAD~1"], { cwd: repo });
const result = await (flag === "--loop" ? reviewWithToolLoop : reviewWithPushedEvidence)(repo, diff);
console.log(result.review);
console.log("\nEvidence:", result.evidence.map((e) => `${e.name}=${e.status}`).join(", ") || "none");
console.log("Gate:", verdict(result));
