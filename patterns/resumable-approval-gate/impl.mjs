// resumable-approval-gate — offline, no API key. `store` stands for a durable checkpoint store,
// `ledger` for the target system's own record of what was already done (keyed, so a replay is a no-op).
import { createHash } from "node:crypto";

export class Crash extends Error {}

const clone = (x) => structuredClone(x);
const digest = (report) => createHash("sha256").update(JSON.stringify(report)).digest("hex");

// Runs again from its first line on every resume: it must stay free of side effects.
export function gate(checkpoint, answer) {
  const ok = answer && ["approve", "reject"].includes(answer.decision) && answer.reviewer
    && answer.digest === checkpoint.digest; // an approval binds to the report the reviewer saw
  return ok ? { decision: answer.decision, reviewer: answer.reviewer } : null;
}

// The irreversible effect: key and effect are one atomic write, so replaying it does nothing.
// Returns the committed entry: on a replay that is the ORIGINAL decision, not the one now supplied.
export function publish(ledger, runId, decision, reviewer, report) {
  const fresh = !ledger.has(runId);
  if (fresh) ledger.set(runId, { decision, reviewer, report: decision === "approve" ? structuredClone(report) : null });
  return { fresh, entry: ledger.get(runId) };
}

export function createRuntime({ store, ledger, onEffect = () => {} }) {
  const advance = (runId, answer, { crashAfterEffect = false } = {}) => {
    const cp = store.get(runId);
    if (cp.phase === "final") throw new Error(`${runId} is finalized`); // terminal: no normal call reopens it
    const decision = gate(cp, answer);
    if (!decision) return clone(cp); // stay paused: nothing published
    if (digest(cp.report) !== cp.digest) throw new Error(`${runId}: report changed since it was approved for review`);
    const { fresh, entry } = publish(ledger, runId, decision.decision, decision.reviewer, cp.report);
    if (!fresh && entry.decision !== decision.decision) // the effect is irreversible: a conflicting retry is refused
      throw new Error(`${runId}: already published as ${entry.decision}`);
    if (fresh) onEffect(runId);
    if (crashAfterEffect) throw new Crash(); // dies between the effect and the checkpoint
    store.set(runId, { ...cp, phase: "final", decision: { decision: entry.decision, reviewer: entry.reviewer } });
    return clone(store.get(runId));
  };
  return {
    start(runId, report) {
      if (store.has(runId)) throw new Error(`${runId} already exists`); // a new input never restarts a thread
      const snapshot = clone(report); // the stored report is the one whose digest was bound
      store.set(runId, { phase: "awaiting_approval", report: snapshot, digest: digest(snapshot) });
      return clone(store.get(runId));
    },
    resume: advance,
  };
}
