/**
 * read-only-meta-loop — minimal reference implementation (no API key, no network, no writes)
 *
 * The pipeline publishes its own diagnostic findings; this turns them into *suggested levers*:
 * where to look to change the pipeline. The whole pattern is the boundary around that step:
 *   - a pure function over a published document (no GitHub call, no file write, no LLM);
 *   - levers come from a fixed table, never from the model;
 *   - only an active warning/critical finding of a mapped rule yields one;
 *   - the table may not name the gates or the loop's own boundary (FORBIDDEN).
 * Applying a lever is an ordinary change, made by a person under the existing gates.
 */
import { fileURLToPath } from "node:url";

export const SUPPORTED_VERSION = 1;

// Targets a lever may never name: workflow files, agent config, eval thresholds and datasets, the
// protected-paths list, attempt caps. Suggesting a weaker gate is how a meta-loop erodes the loop.
const FORBIDDEN = [/^\.github\//, /^\.claude\//, /threshold/i, /^evals\/datasets\//, /protected-paths/, /attempt/i];

// rule id -> where to look. `gate`: the eval suite that measures a change to that target, or null.
export const LEVERS = Object.freeze({
  "review-withheld": {
    stage: "review",
    summary: "Reviews are withheld on a prompt budget that does not fit the diffs",
    targets: [
      { ref: "config/models.yaml#review_max_input_tokens", gate: "review" },
      { ref: "config/models.yaml#anthropic_review_max_diff_chars", gate: "review" },
    ],
  },
  "autofix-ineffective": {
    stage: "autofix",
    summary: "Auto-fix attempts end without a push",
    targets: [
      { ref: "config/models.yaml#autofix_max_input_tokens", gate: null },
      { ref: "prompts/auto-fix-system.md", gate: null },
    ],
  },
});

// A rule with no lever says why. A rule in neither table is a gap the exhaustiveness check reports.
export const NO_LEVER = Object.freeze({
  "runs-failed": "needs a root cause first",
  escalations: "a person is the lever",
  "review-duplicates": "fixed in .github/, which a lever may not name",
});

/** Throws when the table breaks its own invariants: a forbidden target, or a rule mapped and unmapped. */
export function validateTable(levers = LEVERS, noLever = NO_LEVER) {
  for (const [id, entry] of Object.entries(levers)) {
    if (id in noLever) throw new Error(`${id} is both mapped and listed as having no lever`);
    for (const { ref } of entry.targets) {
      if (FORBIDDEN.some((re) => re.test(ref))) throw new Error(`${id}: forbidden target ${ref}`);
    }
  }
}

/** Rule ids that are neither mapped nor explained: a new rule must come with a decision. */
export function unmappedRules(ruleIds, levers = LEVERS, noLever = NO_LEVER) {
  return ruleIds.filter((id) => !(id in levers) && !(id in noLever));
}

/** The lever of one finding, or null: resolved, info, and unmapped findings are observations. */
export function leverFor(finding, levers = LEVERS) {
  if (finding.status !== "active") return null;
  if (finding.severity !== "warning" && finding.severity !== "critical") return null;
  const entry = levers[finding.id];
  if (!entry) return null;
  return {
    stage: entry.stage,
    summary: entry.summary,
    targets: entry.targets.map((t) => ({ ...t, requires: t.gate ? `evals:${t.gate}` : "no-eval-gate" })),
    verified: false, // where to look, not proof of the cause
  };
}

function whyNot(finding, noLever) {
  if (finding.status !== "active") return "resolved";
  if (finding.severity === "info") return "info (a guardrail doing its job)";
  return noLever[finding.id] ?? "no lever mapped";
}

/** Findings document in, proposals out. Pure: never mutates the input, performs no I/O. */
export function suggest(doc, { levers = LEVERS, noLever = NO_LEVER } = {}) {
  if (doc?.schema_version !== SUPPORTED_VERSION) throw new Error(`unsupported schema_version: ${doc?.schema_version}`);
  if (doc.status === "no_data") return { proposals: [], notProposed: [], blocked: "no_data" };
  const proposals = [];
  const notProposed = [];
  for (const f of doc.findings) {
    const lever = leverFor(f, levers);
    if (lever) proposals.push({ key: f.key, observed: f.fact, hypothesis: f.hypothesis ?? null, lever });
    else notProposed.push({ key: f.key, reason: whyNot(f, noLever) });
  }
  return { proposals, notProposed, blocked: null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateTable();
  const doc = {
    schema_version: 1,
    status: "warning",
    findings: [
      { key: "review-withheld", id: "review-withheld", severity: "warning", status: "active",
        fact: "7 of 12 verdicts WITHHELD; 5 anomalies (REQUEST_CHANGES on unseen code).", hypothesis: "The prompt budget cuts the diff." },
      { key: "autofix-ineffective", id: "autofix-ineffective", severity: "info", status: "active", fact: "2 of 3 attempts blocked by a protected path." },
      { key: "review-duplicates", id: "review-duplicates", severity: "warning", status: "active", fact: "4 heads reviewed twice." },
      { key: "runs-failed", id: "runs-failed", severity: "critical", status: "resolved", fact: "1 failed run." },
    ],
  };
  const { proposals, notProposed } = suggest(doc);
  console.log(JSON.stringify({ proposals, notProposed }, null, 2));
  console.log("\nNothing was written, posted or created: the output is the only effect.");
}
