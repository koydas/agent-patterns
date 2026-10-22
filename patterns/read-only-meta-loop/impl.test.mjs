import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVERS, NO_LEVER, leverFor, suggest, unmappedRules, validateTable } from "./impl.mjs";

const active = (id, severity = "warning") => ({ key: id, id, severity, status: "active", fact: `fact of ${id}`, hypothesis: null });
const doc = (...findings) => ({ schema_version: 1, status: "warning", findings });

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

test("an active warning of a mapped rule yields a lever, unverified, with a requirement per target", () => {
  const lever = leverFor(active("autofix-ineffective"));
  assert.equal(lever.verified, false);
  assert.deepEqual(lever.targets.map((t) => t.requires), ["no-eval-gate", "no-eval-gate"]);
  assert.deepEqual(leverFor(active("review-withheld")).targets.map((t) => t.requires), ["evals:review", "evals:review"]);
});

test("a resolved, an info or an unmapped finding yields no lever", () => {
  assert.equal(leverFor({ ...active("review-withheld"), status: "resolved" }), null);
  assert.equal(leverFor(active("review-withheld", "info")), null);
  assert.equal(leverFor(active("something-new")), null);
});

test("the fact is quoted as published and the hypothesis stays a hypothesis", () => {
  const f = { ...active("review-withheld"), fact: "7 of 12 WITHHELD", hypothesis: "budget cut" };
  const [p] = suggest(doc(f)).proposals;
  assert.equal(p.observed, "7 of 12 WITHHELD");
  assert.equal(p.hypothesis, "budget cut");
  assert.equal(p.lever.verified, false);
});

test("every finding without a lever is listed with its reason, none is dropped", () => {
  const r = suggest(doc(
    { ...active("runs-failed", "critical"), status: "resolved" },
    active("autofix-ineffective", "info"),
    active("review-duplicates"),
    active("something-new"),
  ));
  assert.deepEqual(r.notProposed.map((n) => n.reason), [
    "resolved", "info (a guardrail doing its job)", "fixed in .github/, which a lever may not name", "no lever mapped",
  ]);
});

test("an unsupported schema_version is refused, not guessed at", () => {
  assert.throws(() => suggest({ schema_version: 2, findings: [] }), /unsupported schema_version: 2/);
  assert.throws(() => suggest(null), /unsupported schema_version/);
});

test("no_data is blocked, never read as health", () => {
  assert.deepEqual(suggest({ schema_version: 1, status: "no_data", findings: [] }), { proposals: [], notProposed: [], blocked: "no_data" });
});

test("read-only: a deeply frozen input is accepted and the output does not alias it", () => {
  const input = deepFreeze(doc(active("review-withheld")));
  const { proposals } = suggest(input);
  assert.notEqual(proposals[0].lever.targets, LEVERS["review-withheld"].targets);
});

test("the shipped table satisfies its own invariants", () => {
  assert.doesNotThrow(() => validateTable());
});

test("a lever may not name a workflow, a threshold, a dataset, the protected list or an attempt cap", () => {
  for (const ref of [".github/workflows/pr-review.yml", "config/evals.yaml#min_verdict_threshold", "evals/datasets/review.jsonl", "config/protected-paths.yaml", "config/models.yaml#max_attempts"]) {
    assert.throws(() => validateTable({ x: { stage: "s", summary: "", targets: [{ ref, gate: null }] } }, {}), /forbidden target/, ref);
  }
});

test("a rule cannot be both mapped and listed as having no lever", () => {
  assert.throws(() => validateTable(LEVERS, { ...NO_LEVER, "review-withheld": "x" }), /both mapped and listed/);
});

test("a rule in neither table is reported", () => {
  assert.deepEqual(unmappedRules(["review-withheld", "runs-failed", "brand-new-rule"]), ["brand-new-rule"]);
});
