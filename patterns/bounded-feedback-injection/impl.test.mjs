import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLessons } from "./impl.mjs";
const now = Date.UTC(2026, 9, 27);
const signal = (id, ts = now) => ({ id, ts });
test("only recurring allowlisted IDs become fixed text", () => {
  const out = selectLessons([signal("module_system"), signal("module_system"), signal("untrusted"), signal("untrusted")], { now });
  assert.deepEqual(out.map(x => x.id), ["module_system"]);
  assert.match(out[0].text, /ESM imports/);
});
test("stale, future and malformed events are ignored", () => {
  assert.deepEqual(selectLessons([signal("module_system", now - 31 * 86400000), signal("module_system", now + 1), { id: "module_system", ts: "now" }], { now }), []);
});
test("limits the recent window and the output budget", () => {
  const items = [signal("module_system"), signal("module_system"), signal("test_count_drop"), signal("test_count_drop")];
  assert.deepEqual(selectLessons(items, { now, window: 2 }).map(x => x.id), ["test_count_drop"]);
  assert.equal(selectLessons(items, { now, maxChars: 5 }).length, 0);
  assert.equal(selectLessons(items, { now, maxLessons: 1 }).length, 1);
});
test("never modifies the event stream", () => {
  const items = Object.freeze([Object.freeze(signal("module_system")), Object.freeze(signal("module_system"))]);
  assert.equal(selectLessons(items, { now }).length, 1);
});
test("zero budgets select nothing", () => {
  const items = [signal("module_system"), signal("module_system")];
  assert.deepEqual(selectLessons(items, { now, maxLessons: 0 }), []);
  assert.deepEqual(selectLessons(items, { now, window: 0 }), []);
});
