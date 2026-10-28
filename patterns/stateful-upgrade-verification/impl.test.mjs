import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyUpgrade } from "./impl.mjs";
const state = { customer: { id: 1, name: "Ada" }, count: 4 };
test("rejects an incompatible version without a migration", () => {
  assert.deepEqual(verifyUpgrade({ oldVersion: "16", newVersion: "18", oldState: state }), { ok: false, reason: "migration_required" });
});
test("preserves source state across a migration", () => {
  const input = structuredClone(state);
  const out = verifyUpgrade({ oldVersion: "16", newVersion: "18", oldState: input, migration: s => ({ ...s, added: true }) });
  assert.equal(out.ok, true);
  assert.deepEqual(input, state);
});
test("rejects dropped or changed probe data", () => {
  assert.equal(verifyUpgrade({ oldVersion: "16", newVersion: "18", oldState: state, migration: () => ({ count: 4 }) }).reason, "data_mismatch");
});
test("accepts an explicitly compatible in-place upgrade", () => {
  assert.equal(verifyUpgrade({ oldVersion: "16", newVersion: "17", oldState: state, canReadInPlace: true }).ok, true);
});
test("compares probe data structurally, ignoring key order", () => {
  const reordered = verifyUpgrade({ oldVersion: "16", newVersion: "18", oldState: state, migration: () => ({ count: 4, customer: { name: "Ada", id: 1 } }) });
  assert.equal(reordered.ok, true);
  const withMap = { index: new Map([["a", 1]]) };
  assert.equal(verifyUpgrade({ oldVersion: "16", newVersion: "18", oldState: withMap, migration: () => ({ index: new Map() }) }).reason, "data_mismatch");
});
