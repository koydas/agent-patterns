import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';

// Follows createRuntime() in patterns/resumable-approval-gate/impl.mjs: start → (process exits) → resume(answer)
// → gate → digest re-check → publish (keyed ledger) → final checkpoint. Crash and replay paths included.

function simulate(c: Config) {
  const r = new Recorder();
  let effects = 0;
  let ledger: string[] = [];
  const setLedger = () => r.set('ledger', [...ledger]);
  r.set('checkpoint', '—').set('process', 'process 1');
  setLedger();
  r.node('run', 'active').log('Autonomous steps run on report r-42', 'info', 'run').wait(1200).node('run', 'ok');
  r.transit('run-report', 300).run('report', 300, 'ok', 'digest 9f3a…').log('Report snapshotted, digest bound', 'muted', 'report');
  r.transit('report-cp1', 300).node('cp1', 'ok', 'awaiting').set('checkpoint', 'awaiting_approval|violet').log('Checkpoint: awaiting_approval', 'violet', 'cp1');
  r.transit('cp1-exit', 300).node('exit', 'ok').log('Process 1 exits — the pause can last days', 'muted', 'exit').wait(1200);

  const answer = { decision: String(c.decision), reviewer: c.reviewer !== false, digest: c.digest !== 'stale' };
  let proc = 2;
  const resume = (decision: string, label: string): 'paused' | 'final' | 'crash' | 'error' => {
    r.set('process', `process ${proc}`);
    r.node('resume', 'active', `process ${proc}`).log(`Process ${proc}: ${label}`, 'info', 'resume').wait(300).node('resume', 'ok');
    proc++;
    r.transit('resume-gate', 300).node('gate', 'active').count('gateRuns').log('Gate re-runs from its first line (pure: no side effect above the wait)', 'info', 'gate').wait(300);
    if (!['approve', 'reject'].includes(decision) || !answer.reviewer || !answer.digest) {
      const why = !['approve', 'reject'].includes(decision) ? `unknown decision "${decision}"` : !answer.reviewer ? 'no reviewer' : 'digest of another report';
      r.node('gate', 'blocked', 'invalid').log(`Invalid answer (${why}) → pause again, nothing published`, 'warn', 'gate');
      r.transit('gate-cp1', 400, { tone: 'warn' }).node('cp1', 'waiting', 'awaiting');
      return 'paused';
    }
    r.node('gate', 'ok', decision);
    if (c.mutated) {
      r.log('Report changed since it was approved for review: digest re-check throws — nothing published', 'fail', 'gate');
      r.node('gate', 'fail', 'digest ≠');
      return 'error';
    }
    r.transit('gate-effect', 300).node('effect', 'active');
    const key = 'r-42';
    const fresh = !ledger.some((l) => l.startsWith(key)) || c.keyed === false;
    if (fresh) {
      effects++;
      ledger = [...ledger, `${key}: ${decision}${effects > 1 ? ` (#${effects})` : ''}|${effects > 1 ? 'fail' : 'ok'}`];
      setLedger();
      r.count('effects').log(c.keyed === false ? `Effect executed (not keyed) — ${effects === 1 ? 'published' : 'PUBLISHED AGAIN'}` : 'Key + effect committed in one atomic write: published', effects > 1 ? 'fail' : 'ok', 'effect');
      r.wait(400).node('effect', effects > 1 ? 'fail' : 'ok', effects > 1 ? `×${effects}` : 'published');
    } else {
      const committed = ledger.find((l) => l.startsWith(key))!.split(': ')[1].split('|')[0];
      if (committed !== decision) {
        r.node('effect', 'fail', 'conflict').log(`Ledger already has "${committed}": a retry saying "${decision}" is refused — the effect is irreversible`, 'fail', 'effect');
        return 'error';
      }
      r.log('Ledger already has r-42: replay is a no-op (the committed entry is used)', 'ok', 'effect').wait(200).node('effect', 'ok', 'no-op');
    }
    if (c.crash && proc === 3) {
      r.log('Process killed between the effect and the final checkpoint', 'fail', 'effect').node('resume', 'fail', 'killed');
      return 'crash';
    }
    r.transit('effect-cp2', 300).node('cp2', 'ok', 'final').set('checkpoint', 'final|ok').log('Checkpoint: final', 'ok', 'cp2');
    r.transit('cp2-done', 300).node('done', 'ok');
    return 'final';
  };

  let s = resume(answer.decision, `resume with "${answer.decision}"`);
  if (s === 'crash') {
    r.wait(1000).set('checkpoint', 'awaiting_approval (stale)|warn').node('cp1', 'waiting', 'still awaiting');
    const again = c.retry === 'conflict' ? (answer.decision === 'approve' ? 'reject' : 'approve') : answer.decision;
    r.node('gate', 'idle', null).node('effect', 'idle', null);
    s = resume(again, `resume again after the crash${again !== answer.decision ? ` — now saying "${again}"` : ''}`);
  }
  if (s === 'final' && c.reopen) {
    r.wait(600).log('A later resume on r-42: the run is finalized — raises, no normal call reopens it', 'warn', 'done').count('refused');
  }
  if (s === 'paused') return r.end('PAUSED again — nothing published', 'violet');
  if (s === 'error') return r.end(effects ? `REFUSED — still published once` : 'REFUSED — nothing published', 'fail');
  return r.end(effects > 1 ? `EFFECT RAN ${effects}× — not keyed` : `Closed — effect ran exactly once`, effects > 1 ? 'fail' : 'ok');
}

export const resumableApprovalGate: PatternSim = {
  slug: 'resumable-approval-gate',
  invariant: 'An approval outlives the process, binds to the report the reviewer saw, and its effect runs once however often the gate replays.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.4,
  params: [
    { key: 'decision', label: 'Reviewer decision', type: 'select', default: 'approve', options: [{ value: 'approve', label: 'approve' }, { value: 'reject', label: 'reject' }, { value: 'lgtm', label: '"lgtm" (unknown)' }] },
    { key: 'reviewer', label: 'Reviewer identified', type: 'toggle', default: true },
    { key: 'digest', label: 'Answer bound to', type: 'select', default: 'match', options: [{ value: 'match', label: 'The report shown' }, { value: 'stale', label: 'Another report (stale digest)' }] },
    { key: 'crash', label: 'Kill the process after the effect', type: 'toggle', default: false, help: 'impl: crashAfterEffect' },
    { key: 'retry', label: 'Resume after the crash with', type: 'select', default: 'same', visibleIf: (c) => c.crash === true, options: [{ value: 'same', label: 'The same answer' }, { value: 'conflict', label: 'The opposite decision' }] },
    { key: 'keyed', label: 'Effect keyed by run id', type: 'toggle', default: true, help: 'Off = key and effect in two writes / no ledger: a replay repeats it.' },
    { key: 'mutated', label: 'Report mutated after start', type: 'toggle', default: false },
    { key: 'reopen', label: 'Resume a finalized run', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'run', label: 'Autonomous steps', kind: 'agent', rank: 0, lane: 0 },
      { id: 'report', label: 'Report + digest', kind: 'store', rank: 1, lane: 0 },
      { id: 'cp1', label: 'Checkpoint', sub: 'awaiting approval', kind: 'store', rank: 2, lane: 0 },
      { id: 'exit', label: 'Process exits', kind: 'end', rank: 3, lane: 0 },
      { id: 'resume', label: 'New process', sub: 'resume(answer)', kind: 'start', rank: 4, lane: 0 },
      { id: 'gate', label: 'Gate', sub: 'answer ↔ digest', kind: 'gate', rank: 5, lane: 0 },
      { id: 'effect', label: 'Effect keyed', sub: 'by run id', kind: 'effect', rank: 6, lane: 0 },
      { id: 'cp2', label: 'Checkpoint', sub: 'final', kind: 'store', rank: 7, lane: 0 },
      { id: 'done', label: 'Closed', kind: 'end', rank: 8, lane: 0 },
    ],
    edges: [
      { id: 'run-report', from: 'run', to: 'report' },
      { id: 'report-cp1', from: 'report', to: 'cp1' },
      { id: 'cp1-exit', from: 'cp1', to: 'exit' },
      { id: 'exit-resume', from: 'exit', to: 'resume' },
      { id: 'resume-gate', from: 'resume', to: 'gate' },
      { id: 'gate-cp1', from: 'gate', to: 'cp1', side: 'near', label: 'invalid → pause' },
      { id: 'gate-effect', from: 'gate', to: 'effect', label: 'valid' },
      { id: 'effect-cp2', from: 'effect', to: 'cp2' },
      { id: 'cp2-done', from: 'cp2', to: 'done' },
    ],
    rankGap: 138,
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'effects', label: 'Irreversible effects executed', format: 'int', better: 'lower' },
    { key: 'gateRuns', label: 'Gate executions', format: 'int' },
    { key: 'duration', label: 'Simulated duration', format: 'ms' },
  ],
  derive: (t: Trace) => ({ outcome: t.outcome?.label ?? '—', effects: t.counters.effects ?? 0, gateRuns: t.counters.gateRuns ?? 0, duration: t.duration }),
  explain: (t, c) => {
    const out: string[] = [];
    const e = t.counters.effects ?? 0;
    if ((t.counters.gateRuns ?? 0) > 1) out.push(`The gate ran ${t.counters.gateRuns} times — a killed process costs one replayed node${e === 1 ? ', not a duplicated effect: the ledger turned the replay into a no-op' : ''}.`);
    if (e > 1) out.push('Without a key committed with the effect, the replay published twice: the effect must be idempotent at the target.');
    if (c.digest === 'stale') out.push('An approval typed for another report does not apply: the digest binds the answer to what the reviewer saw.');
    if (c.mutated) out.push('The stored report changed after review: the digest re-check refused to publish it.');
    if (c.retry === 'conflict' && c.crash) out.push('After the effect committed, a retry with the opposite decision is refused — recovery uses the committed entry.');
    if (c.reopen) out.push('The final checkpoint is terminal: resuming a finalized run raises instead of reopening it.');
    if (!out.length) out.push('One process paused, another resumed: the approval was durable and the effect ran exactly once.');
    return out;
  },
  compare: (a, b) => [`Effects executed: A ${a.metrics.effects}, B ${b.metrics.effects}. A ends "${a.metrics.outcome}", B ends "${b.metrics.outcome}".`],
  presets: [
    { id: 'default', label: 'Approve across processes', description: 'Pause, exit, resume, publish once.', kind: 'scenario', config: {} },
    { id: 'crash', label: 'Killed after the effect', description: 'Replay: gate runs twice, effect once.', kind: 'scenario', config: { crash: true } },
    { id: 'stale', label: 'Digest not bound', description: 'Approval for another report.', kind: 'failure', config: { digest: 'stale' } },
    { id: 'twowrites', label: 'Key and effect in two writes', description: 'Replay publishes again.', kind: 'failure', config: { crash: true, keyed: false } },
    { id: 'conflict', label: 'Replay with another decision', description: 'Refused after commit.', kind: 'failure', config: { crash: true, retry: 'conflict' } },
    { id: 'mutable', label: 'Mutable report', description: 'Re-verified before publishing.', kind: 'failure', config: { mutated: true } },
  ],
  comparePresets: [
    { id: 'keyed', label: 'Keyed vs unkeyed effect', description: 'Same crash between effect and checkpoint.', a: { label: 'Effect not keyed', config: { crash: true, keyed: false } }, b: { label: 'Keyed ledger (impl)', config: { crash: true } } },
  ],
  state: [{ key: 'process', label: 'Process' }, { key: 'checkpoint', label: 'Checkpoint' }, { key: 'ledger', label: 'Target ledger (keyed)', empty: 'empty' }],
};
