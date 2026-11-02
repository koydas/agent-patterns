import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime, Crash } from "./impl.mjs";

const report = { findings: [{ id: "c1", outcome: "verified" }] };
const fresh = () => {
  const store = new Map(), ledger = new Map(), effects = [];
  const runtime = () => createRuntime({ store, ledger, onEffect: (id) => effects.push(id) });
  return { store, ledger, effects, runtime };
};
const answer = (cp, decision = "approve") => ({ decision, reviewer: "me", digest: cp.digest });

test("the pause survives a restart: a new runtime over the same store resumes it", () => {
  const t = fresh();
  const cp = t.runtime().start("r1", report);
  assert.equal(t.effects.length, 0);
  const out = t.runtime().resume("r1", answer(cp)); // a different runtime object = a different process
  assert.equal(out.phase, "final");
  assert.equal(t.ledger.get("r1").decision, "approve");
});

test("approval and rejection differ; rejection publishes no report", () => {
  const a = fresh(), r = fresh();
  a.runtime().resume("r1", answer(a.runtime().start("r1", report)));
  r.runtime().resume("r1", answer(r.runtime().start("r1", report), "reject"));
  assert.ok(a.ledger.get("r1").report);
  assert.equal(r.ledger.get("r1").report, null);
});

test("a stale digest, an unknown decision or no reviewer keep the run paused and publish nothing", () => {
  const t = fresh(), cp = t.runtime().start("r1", report);
  for (const bad of [{ ...answer(cp), digest: "stale" }, { ...answer(cp), decision: "yes" }, { ...answer(cp), reviewer: "" }, undefined]) {
    assert.equal(t.runtime().resume("r1", bad).phase, "awaiting_approval");
  }
  assert.equal(t.ledger.size, 0);
});

test("a crash between the effect and the checkpoint replays without a second effect", () => {
  const t = fresh(), cp = t.runtime().start("r1", report);
  assert.throws(() => t.runtime().resume("r1", answer(cp), { crashAfterEffect: true }), Crash);
  assert.equal(t.store.get("r1").phase, "awaiting_approval"); // the checkpoint never advanced
  assert.equal(t.runtime().resume("r1", answer(cp)).phase, "final"); // the gate and finalize ran again
  assert.deepEqual(t.effects, ["r1"], "the node ran twice, the effect once");
});

test("a finalized run is closed to start and resume", () => {
  const t = fresh(), cp = t.runtime().start("r1", report);
  t.runtime().resume("r1", answer(cp));
  assert.throws(() => t.runtime().start("r1", report), /already exists/);
  assert.throws(() => t.runtime().resume("r1", answer(cp, "reject")), /finalized/);
  assert.equal(t.ledger.get("r1").decision, "approve");
});

test("a conflicting retry after the effect committed is refused; the original decision stands", () => {
  const t = fresh(), cp = t.runtime().start("r1", report);
  assert.throws(() => t.runtime().resume("r1", answer(cp), { crashAfterEffect: true }), Crash);
  assert.throws(() => t.runtime().resume("r1", answer(cp, "reject")), /already published as approve/);
  assert.equal(t.store.get("r1").phase, "awaiting_approval");
  const out = t.runtime().resume("r1", { ...answer(cp), reviewer: "someone-else" }); // same decision, replayed
  assert.equal(out.decision.reviewer, "me", "attribution comes from the committed entry");
  assert.equal(t.ledger.get("r1").decision, "approve");
});

test("mutating the caller's report after start does not change what is published", () => {
  const t = fresh(), mine = { findings: [{ id: "c1", outcome: "verified" }] };
  const cp = t.runtime().start("r1", mine);
  mine.findings[0].outcome = "failed"; // after the reviewer was shown the digest
  t.runtime().resume("r1", answer(cp));
  assert.equal(t.ledger.get("r1").report.findings[0].outcome, "verified");
  cp.report.findings.push({ id: "x" }); // a returned checkpoint is a copy, not the stored state
  assert.equal(t.store.get("r1").report.findings.length, 1);
});

test("a stored report altered behind the runtime's back is refused before publication", () => {
  const t = fresh(), cp = t.runtime().start("r1", report);
  t.store.get("r1").report.findings.push({ id: "tampered" });
  assert.throws(() => t.runtime().resume("r1", answer(cp)), /report changed/);
  assert.equal(t.ledger.size, 0);
});
