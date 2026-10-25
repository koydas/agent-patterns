import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministic, checkModelAnswer, signature, climb } from "./impl.mjs";

const real = { ours: "- ours\n", base: "", theirs: "- theirs\n" };
const union = async (h) => `${h.theirs}${h.ours}`;
const never = async () => { throw new Error("the model must not be called"); };

test("deterministic: identical sides, one side unchanged, or a real conflict (null)", () => {
  assert.equal(deterministic({ ours: "x", base: "y", theirs: "x" }), "x");
  assert.equal(deterministic({ ours: "a", base: "a", theirs: "b" }), "b");
  assert.equal(deterministic({ ours: "b", base: "a", theirs: "a" }), "b");
  assert.equal(deterministic(real), null);
});

test("checkModelAnswer: a union passes; invented lines, markers and non-strings are refused", () => {
  assert.equal(checkModelAnswer(real, "- theirs\n- ours\n"), null);
  assert.equal(checkModelAnswer(real, "- theirs\n- ours\n- one new\n"), null, "one combined line is tolerated");
  assert.equal(checkModelAnswer(real, "- theirs\n- new 1\n- new 2\n"), "invented_content");
  assert.equal(checkModelAnswer(real, "<<<<<<< HEAD\n- ours\n"), "marker_left");
  assert.equal(checkModelAnswer(real, 42), "malformed");
  assert.equal(checkModelAnswer(real, "- new 1\n- new 2\n", { maxInvented: 2 }), null);
});

test("climb: the model is never called for a hunk a deterministic rung resolves", async () => {
  const res = await climb([{ ours: "a", base: "a", theirs: "b" }, { ours: "c", base: "c", theirs: "c" }], { callModel: never });
  assert.deepEqual(res, { outcome: "resolved", rungs: ["deterministic", "deterministic"], resolutions: ["b", "c"] });
});

test("climb: a real conflict goes to the model, the rest of the file is not its business", async () => {
  const res = await climb([{ ours: "a", base: "a", theirs: "b" }, real], { callModel: union });
  assert.deepEqual(res, { outcome: "resolved", rungs: ["deterministic", "model"], resolutions: ["b", "- theirs\n- ours\n"] });
});

test("climb: one refused hunk refuses the whole file, and the reason is a code", async () => {
  const bad = await climb([real, real], { callModel: async () => "- x\n- y\n- z\n" });
  assert.deepEqual(bad, { outcome: "escalated", reason: "invented_content", hunk: 0 });
  const second = await climb([real, real], { callModel: (() => { let n = 0; return async (h) => (n++ ? "<<<<<<< x" : union(h)); })() });
  assert.deepEqual(second, { outcome: "escalated", reason: "marker_left", hunk: 1 });
  assert.deepEqual(await climb([real]), { outcome: "escalated", reason: "no_model", hunk: 0 });
});

test("climb: the breaker stops a conflict that already escalated, a person overrides it, another conflict is unaffected", async () => {
  const previous = { sig: signature([real]), escalated: true };
  assert.deepEqual(await climb([real], { callModel: never, previous }), { outcome: "escalated", reason: "circuit_open", hunk: null });
  assert.equal((await climb([real], { callModel: union, previous, manual: true })).outcome, "resolved");
  assert.equal((await climb([{ ...real, theirs: "- other\n" }], { callModel: union, previous })).outcome, "resolved");
  assert.equal((await climb([real], { callModel: union, previous: { ...previous, escalated: false } })).outcome, "resolved");
});

test("signature: stable for the same incoming side, different for another", () => {
  assert.equal(signature([real]), signature([{ ...real, ours: "changed" }]));
  assert.notEqual(signature([real]), signature([{ ...real, theirs: "x" }]));
  assert.match(signature([]), /^[0-9a-f]{10}$/);
});
