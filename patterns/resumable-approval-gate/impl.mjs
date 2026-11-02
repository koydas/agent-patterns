// resumable-approval-gate — offline, no API key. `store` stands for a durable checkpoint store,
// `ledger` for the target system's own record of what was already done (keyed, so a replay is a no-op).
import { createHash } from "node:crypto";

export class Crash extends Error {}

const digest = (report) => createHash("sha256").update(JSON.stringify(report)).digest("hex");

// Runs again from its first line on every resume: it must stay free of side effects.
export function gate(checkpoint, answer) {
  const ok = answer && ["approve", "reject"].includes(answer.decision) && answer.reviewer
    && answer.digest === checkpoint.digest; // an approval binds to the report the reviewer saw
  return ok ? { decision: answer.decision, reviewer: answer.reviewer } : null;
}

// The irreversible effect: key and effect are one atomic write, so replaying it does nothing.
export function publish(ledger, runId, decision, report) {
  if (ledger.has(runId)) return false;
  ledger.set(runId, { decision, report: decision === "approve" ? report : null });
  return true;
}

export function createRuntime({ store, ledger, onEffect = () => {} }) {
  const advance = (runId, answer, { crashAfterEffect = false } = {}) => {
    const cp = store.get(runId);
    if (cp.phase === "final") throw new Error(`${runId} is finalized`); // terminal: no normal call reopens it
    const decision = gate(cp, answer);
    if (!decision) return cp; // stay paused: nothing published
    if (publish(ledger, runId, decision.decision, cp.report)) onEffect(runId);
    if (crashAfterEffect) throw new Crash(); // dies between the effect and the checkpoint
    store.set(runId, { ...cp, phase: "final", decision });
    return store.get(runId);
  };
  return {
    start(runId, report) {
      if (store.has(runId)) throw new Error(`${runId} already exists`); // a new input never restarts a thread
      store.set(runId, { phase: "awaiting_approval", report, digest: digest(report) });
      return store.get(runId);
    },
    resume: advance,
  };
}
