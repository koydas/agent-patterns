import { Recorder } from '../engine/recorder';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const STAGES = [
  { id: 'analyst', label: 'ticket-analyst', ok: 'READY' },
  { id: 'builder', label: 'code-builder', ok: 'READY' },
  { id: 'reviewer', label: 'code-reviewer', ok: 'APPROVED' },
] as const;
const OUTPUT = 2400; // full output of a stage
const HANDOFF = 300; // its ### Handoff block

function simulate(c: Config) {
  const r = new Recorder();
  r.set('handoff', '—').node('issue', 'ok').log('Issue: "Add input validation to the registration form"', 'muted', 'issue').transit('issue-analyst', 300);
  for (const [k, s] of STAGES.entries()) {
    const outcome = String(c[s.id]);
    r.node(s.id, 'active').log(`${s.label} runs${k ? ` on ${c.passing === 'full' ? 'the previous full output' : 'the previous ### Handoff only'}` : ''}`, 'info', s.id);
    r.wait(1500).count('calls').count('context', k ? (c.passing === 'full' ? OUTPUT : HANDOFF) : 400);
    const drift = c.drift && s.id === 'builder';
    if (outcome === 'refusal') {
      r.node(s.id, 'blocked', 'BLOCKED').log('stop_reason "refusal" → mapped onto the contract: ### Status BLOCKED, reason in ### Handoff', 'warn', s.id);
      r.transit(`${s.id}-halt`, 350, { tone: 'warn' }).node(`halt${k}`, 'blocked');
      return r.end(`HALTED at ${s.label} (refusal)`, 'warn');
    }
    if (outcome === 'BLOCKED') {
      r.node(s.id, 'blocked', 'BLOCKED').log(`### Status BLOCKED — the pipeline halts at ${s.label}, the failure surfaces at its own layer`, 'warn', s.id);
      r.transit(`${s.id}-halt`, 350, { tone: 'warn' }).node(`halt${k}`, 'blocked');
      return r.end(`HALTED at ${s.label}`, 'warn');
    }
    if (outcome === 'CHANGES_REQUESTED') {
      r.node(s.id, 'blocked', outcome).log('Reviewer: CHANGES_REQUESTED → halt / escalate (no backtracking upstream)', 'warn', s.id);
      r.transit(`${s.id}-halt`, 350, { tone: 'warn' }).node(`halt${k}`, 'blocked');
      return r.end('HALTED — changes requested', 'warn');
    }
    r.node(s.id, 'ok', drift ? 'format drift' : s.ok);
    if (drift) {
      r.log('code-builder writes "## Hand-off notes" instead of "### Handoff": parseHandoff() finds no block and falls back to the whole output', 'fail', s.id);
      r.set('handoff', 'whole output (no Handoff block)|fail').count('drift');
    } else r.set('handoff', k < 2 ? `### Handoff of ${s.label}|accent` : 'final verdict|ok');
    if (k < 2) r.transit(`${s.id}-${STAGES[k + 1].id}`, 350, { label: c.passing === 'full' || drift ? 'full output' : 'Handoff' });
    if (drift && k === 1) r.count('context', OUTPUT - HANDOFF);
  }
  r.transit('reviewer-done', 300, { tone: 'ok' }).node('done', 'ok');
  return r.end(c.drift ? 'APPROVED — on an unparsed handoff' : 'APPROVED — output ready', c.drift ? 'warn' : 'ok');
}

export const sequentialPipeline: PatternSim = {
  slug: 'sequential-pipeline',
  invariant: 'Each stage reads only the previous ### Handoff, and any BLOCKED status halts the chain where it happened.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.5,
  params: [
    { key: 'analyst', label: 'ticket-analyst status', type: 'select', default: 'READY', options: [{ value: 'READY', label: 'READY' }, { value: 'BLOCKED', label: 'BLOCKED' }, { value: 'refusal', label: 'Refusal' }] },
    { key: 'builder', label: 'code-builder status', type: 'select', default: 'READY', options: [{ value: 'READY', label: 'READY' }, { value: 'BLOCKED', label: 'BLOCKED' }, { value: 'refusal', label: 'Refusal' }] },
    { key: 'reviewer', label: 'code-reviewer verdict', type: 'select', default: 'APPROVED', options: [{ value: 'APPROVED', label: 'APPROVED' }, { value: 'CHANGES_REQUESTED', label: 'CHANGES_REQUESTED' }] },
    { key: 'passing', label: 'What the next stage reads', type: 'select', default: 'handoff', options: [
      { value: 'handoff', label: '### Handoff only (impl)' },
      { value: 'full', label: 'Full prose output' },
    ] },
    { key: 'drift', label: 'Builder drifts its Handoff format', type: 'toggle', default: false, help: 'Failure mode: schema drift.' },
  ],
  graph: () => ({
    nodes: [
      { id: 'issue', label: 'Issue', kind: 'start', rank: 0, lane: 0 },
      ...STAGES.map((s, k) => ({ id: s.id, label: s.label, sub: 'agent', kind: 'agent' as const, rank: 1 + k, lane: 0 })),
      ...STAGES.map((_, k) => ({ id: `halt${k}`, label: k === 2 ? 'Halt / escalate' : 'Halt', kind: 'fail' as const, rank: 1 + k, lane: 1 })),
      { id: 'done', label: 'Output ready', kind: 'end', rank: 4, lane: 0 },
    ],
    edges: [
      { id: 'issue-analyst', from: 'issue', to: 'analyst' },
      { id: 'analyst-builder', from: 'analyst', to: 'builder' },
      { id: 'builder-reviewer', from: 'builder', to: 'reviewer' },
      ...STAGES.map((s, k) => ({ id: `${s.id}-halt`, from: s.id, to: `halt${k}`, label: k === 2 ? 'CHANGES' : 'BLOCKED' })),
      { id: 'reviewer-done', from: 'reviewer', to: 'done', label: 'APPROVED' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'calls', label: 'Agent calls', format: 'int' },
    { key: 'context', label: 'Context passed between stages', format: 'units', better: 'lower', hint: 'Simulated tokens: Handoff ≈ 300, full output ≈ 2400.' },
    { key: 'duration', label: 'Simulated duration', format: 'ms' },
  ],
  derive: (t: Trace) => ({ outcome: t.outcome?.label ?? '—', calls: t.counters.calls ?? 0, context: t.counters.context ?? 0, duration: t.duration }),
  explain: (t, c) => {
    const out: string[] = [];
    const label = t.outcome?.label ?? '';
    if (label.startsWith('HALTED')) out.push(`The chain stopped at the stage that failed; no later agent ran on a broken handoff (${t.counters.calls} of 3 calls made).`);
    if (c.passing === 'full') out.push('Passing full prose multiplies the context each stage reads, and makes it interpret prose instead of a contract.');
    if (t.counters.drift) out.push('Schema drift is silent: the parser fell back to the whole output and the next agent got prose it was never designed to read.');
    if (label.startsWith('APPROVED') && !t.counters.drift) out.push('Three agents, three contracts: each stage was machine-checkable on its Status line.');
    return out;
  },
  compare: (a, b) => metricDeltas(sequentialPipeline.metrics, a, b),
  presets: [
    { id: 'default', label: 'Happy path', description: 'All stages READY, reviewer approves.', kind: 'scenario', config: {} },
    { id: 'blocked', label: 'Builder BLOCKED', description: 'Halts at the builder.', kind: 'failure', config: { builder: 'BLOCKED' } },
    { id: 'refusal', label: 'Refusal at analyst', description: 'Mapped onto BLOCKED, no crash.', kind: 'failure', config: { analyst: 'refusal' } },
    { id: 'changes', label: 'Changes requested', description: 'No backtracking: halt and escalate.', kind: 'failure', config: { reviewer: 'CHANGES_REQUESTED' } },
    { id: 'drift', label: 'Schema drift', description: 'Builder breaks the Handoff format.', kind: 'failure', config: { drift: true } },
  ],
  phases: [{ label: 'Analyst', nodes: ['issue', 'analyst'] }, { label: 'Builder', nodes: ['builder'] }, { label: 'Reviewer', nodes: ['reviewer'] }, { label: 'Outcome', nodes: ['done', 'halt0', 'halt1', 'halt2'] }],
  comparePresets: [
    { id: 'contract', label: 'Handoff vs full output', description: 'Same pipeline, two ways to pass context.', a: { label: 'Full prose output', config: { passing: 'full' } }, b: { label: '### Handoff only', config: {} } },
  ],
  state: [{ key: 'handoff', label: 'Context passed forward' }],
};
