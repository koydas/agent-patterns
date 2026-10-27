import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRatchet } from "./impl.mjs";
const floor = { metrics: [{ id: "accuracy", min: 0.8, optional: false }, { id: "errors", max: 0.05, optional: false }], cases: [{ id: "hard-1", label: "invalid", inputHash: "abc" }] };
const copy = () => structuredClone({ ...floor, filtered: false });
test("accepts unchanged or tightened gates", () => {
  assert.equal(checkRatchet(floor, copy()).ok, true);
  const stronger = copy(); stronger.metrics[0].min = 0.9;
  assert.equal(checkRatchet(floor, stronger).ok, true);
});
test("rejects weaker bounds", () => {
  const x = copy(); x.metrics[0].min = 0.7; x.metrics[1].max = 0.1;
  assert.deepEqual(checkRatchet(floor, x).failures, ["min_weakened:accuracy", "max_weakened:errors"]);
});
test("rejects missing and optional metrics", () => {
  const x = copy(); x.metrics.shift(); x.metrics[0].optional = true;
  assert.deepEqual(checkRatchet(floor, x).failures, ["metric_removed:accuracy", "metric_optional:errors"]);
});
test("rejects changed, removed or exempted gated cases", () => {
  const x = copy(); x.cases[0].label = "valid";
  assert.deepEqual(checkRatchet(floor, x).failures, ["case_changed:hard-1"]);
  x.cases[0].knownGap = true;
  assert.deepEqual(checkRatchet(floor, x).failures, ["case_changed:hard-1"]);
  x.cases = [];
  assert.deepEqual(checkRatchet(floor, x).failures, ["case_removed:hard-1"]);
});
test("rejects filtered evals", () => {
  const x = copy(); x.filtered = true;
  assert.deepEqual(checkRatchet(floor, x).failures, ["filtered_evaluation"]);
});
