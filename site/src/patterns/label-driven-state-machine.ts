import { Recorder } from '../engine/recorder';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);

function simulate(c: Config) {
  const r = new Recorder();
  const lat = n(c, 'dispatch') * 1000;
  const max = n(c, 'maxAttempts');
  let labels: string[] = [];
  const show = () => r.set('labels', [...labels]);
  const add = (l: string, tone = 'accent') => { const repulse = labels.some((x) => x.startsWith(`${l}|`)); labels = [...labels.filter((x) => !x.startsWith(`${l}|`)), `${l}|${tone}`]; show(); r.count('events'); return repulse; };
  const remove = (l: string) => { labels = labels.filter((x) => !x.startsWith(`${l}|`)); show(); };
  const dispatch = (edge: string, label: string, tone: 'accent' | 'warn' | 'ok' = 'accent') => r.transit(edge, lat, { label, tone });

  show();
  r.node('issue', 'ok').log('Issue created', 'muted', 'issue').transit('issue-validate', 400);
  r.run('validate', 1200).count('runs');
  if (c.valid === 'no') { add('needs-refinement', 'warn'); r.node('validate', 'blocked').log('Validator applies needs-refinement: no workflow listens to it — the pipeline stops', 'warn', 'validate'); return r.end('Stopped: needs-refinement', 'warn'); }
  if (c.typo) {
    add('ready-for-deev', 'fail');
    r.log('Validator applies "ready-for-deev" (typo): the generate workflow triggers on "ready-for-dev" — nothing fires', 'fail', 'validate');
    r.wait(2500).node('generate', 'skipped', 'never triggered');
    return r.end('STALLED — missing label, no transition', 'fail');
  }
  add('ready-for-dev');
  r.log('labeled: ready-for-dev', 'accent', 'validate');
  dispatch('validate-generate', 'ready-for-dev');
  r.run('generate', 1800).count('runs');
  remove('ready-for-dev'); add('needs-review');
  r.log('Generator opens PR #42 — removes ready-for-dev, applies needs-review', 'accent', 'generate');
  dispatch('generate-review', 'needs-review');
  const approveAt = c.approveAfter === 'never' ? Infinity : Number(c.approveAfter);
  for (let review = 1; ; review++) {
    r.run('review', 1500, 'ok', `review ${review}`).count('runs');
    remove('needs-review');
    if (c.bypass && review === 2) {
      add('review-approved', 'ok');
      r.node('review', 'warn', 'manual').log('An operator applies review-approved by hand before the loop finished: the loop guard is bypassed', 'warn', 'review');
      dispatch('review-human', 'review-approved', 'ok');
      r.node('human', 'waiting');
      return r.end('Approved by manual label — guard bypassed', 'warn');
    }
    if (review >= approveAt) {
      remove('changes-requested'); add('review-approved', 'ok');
      r.log(`Review ${review}: approved → review-approved`, 'ok', 'review');
      dispatch(review === 1 ? 'review-human' : 'review-human', 'review-approved', 'ok');
      r.node('human', 'waiting').log('Human merge decision', 'violet', 'human');
      return r.end(`review-approved after ${review} review${review > 1 ? 's' : ''}`, 'violet');
    }
    add(`auto-fix-attempt-${review}`, 'muted');
    remove('changes-requested');
    add('changes-requested', 'warn');
    r.log(`Review ${review}: changes requested → auto-fix-attempt-${review}; remove + re-add changes-requested (re-pulse emits a fresh labeled event)`, 'warn', 'review');
    dispatch('review-fix', 'changes-requested', 'warn');
    const attempt = labels.filter((l) => l.startsWith('auto-fix-attempt-')).length;
    if (c.race && review === 1) {
      r.log('A second changes-requested event fires close behind: without a concurrency group, two auto-fix runs read attempt = 1', 'fail', 'fix');
      r.node('fix', 'fail', 'run ×2').count('runs', 2).count('duplicates').wait(1400);
      r.log('Both push a commit: duplicate fixes, attempt counter wrong (ADR-0020 added per-PR concurrency)', 'fail', 'fix');
      return r.end('RACE — duplicate auto-fix commits', 'fail');
    }
    if (attempt > max) {
      r.node('fix', 'fail', `${attempt - 1}/${max}`).log(`auto-fix: attempt ${attempt} > ${max} — comment and escalate`, 'fail', 'fix');
      add('needs-human', 'violet');
      dispatch('fix-escalate', 'escalate', 'warn');
      r.node('escalate', 'waiting');
      return r.end(`Escalated after ${max} fix attempts`, 'violet');
    }
    r.run('fix', 1600, 'ok', `${attempt}/${max}`).count('runs').log(`auto-fix attempt ${attempt}/${max} pushes a commit, applies needs-review`, 'info', 'fix');
    remove('changes-requested'); add('needs-review');
    dispatch('fix-review', 'needs-review');
  }
}

export const labelDrivenStateMachine: PatternSim = {
  slug: 'label-driven-state-machine',
  invariant: 'The label set on the PR is the only state store: each workflow is triggered by one label and applies the next.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 3,
  params: [
    { key: 'valid', label: 'Validator verdict', type: 'select', default: 'yes', options: [{ value: 'yes', label: 'ready-for-dev' }, { value: 'no', label: 'needs-refinement' }] },
    { key: 'approveAfter', label: 'Reviews until approval', type: 'select', default: '3', options: ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v })).concat([{ value: 'never', label: 'Never' }]) },
    { key: 'maxAttempts', label: 'Max auto-fix attempts', type: 'number', min: 1, max: 5, step: 1, default: 3, source: 'impl: MAX_FIX_ATTEMPTS = 3' },
    { key: 'dispatch', label: 'Label event dispatch latency', type: 'number', min: 1, max: 20, step: 1, default: 4, unit: 's', help: 'GitHub Actions takes seconds to start a workflow on a labeled event.' },
    { key: 'race', label: 'Two events close together, no concurrency group', type: 'toggle', default: false },
    { key: 'typo', label: 'Label typo', type: 'toggle', default: false },
    { key: 'bypass', label: 'Operator applies review-approved early', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'issue', label: 'Issue created', kind: 'start', rank: 0, lane: 0 },
      { id: 'validate', label: 'Validate', sub: 'workflow', kind: 'agent', rank: 1, lane: 0 },
      { id: 'generate', label: 'Generate', sub: 'workflow', kind: 'agent', rank: 2, lane: 0 },
      { id: 'review', label: 'Review', sub: 'workflow', kind: 'agent', rank: 3, lane: 0 },
      { id: 'fix', label: 'Auto-fix', sub: 'workflow', kind: 'agent', rank: 3, lane: 1 },
      { id: 'human', label: 'Human merge', kind: 'human', rank: 4, lane: 0 },
      { id: 'escalate', label: 'Escalate', kind: 'human', rank: 4, lane: 1 },
    ],
    edges: [
      { id: 'issue-validate', from: 'issue', to: 'validate' },
      { id: 'validate-generate', from: 'validate', to: 'generate', label: 'ready-for-dev' },
      { id: 'generate-review', from: 'generate', to: 'review', label: 'needs-review' },
      { id: 'review-fix', from: 'review', to: 'fix', shift: -18, label: 'changes-requested' },
      { id: 'fix-review', from: 'fix', to: 'review', shift: 18 },
      { id: 'review-human', from: 'review', to: 'human', label: 'review-approved' },
      { id: 'fix-escalate', from: 'fix', to: 'escalate', label: 'attempt > max' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'runs', label: 'Workflow runs', format: 'int', better: 'lower' },
    { key: 'events', label: 'Label events', format: 'int' },
    { key: 'duration', label: 'Simulated wall time', format: 'ms', better: 'lower', hint: 'Dominated by event dispatch latency.' },
  ],
  derive: (t: Trace) => ({ outcome: t.outcome?.label ?? '—', runs: t.counters.runs ?? 0, events: t.counters.events ?? 0, duration: t.duration }),
  explain: (t, c) => {
    const out: string[] = [];
    const label = t.outcome?.label ?? '';
    if (label.startsWith('Escalated')) out.push(`The attempt counter lives in label names (auto-fix-attempt-N): attempt ${n(c, 'maxAttempts') + 1} saw ${n(c, 'maxAttempts')} of them and escalated.`);
    if (label.startsWith('review-approved')) out.push('Every transition is a visible label: an operator reading the PR sees exactly where the pipeline is.');
    if (c.typo) out.push('Labels are stringly typed: one typo and no workflow listens — the pipeline stalls without an error.');
    if (c.race) out.push('Labels are read without a lock: two runs read the same attempt count. Per-PR concurrency groups serialize them.');
    if (c.bypass) out.push('Manual override is trivial — and so is skipping the loop guard.');
    out.push(`Each transition waited ~${n(c, 'dispatch')} s for event dispatch: fine for a review loop, too slow for a tight one.`);
    return out;
  },
  compare: (a, b) => metricDeltas(labelDrivenStateMachine.metrics, a, b),
  presets: [
    { id: 'default', label: 'Two fixes, then approved', description: 'Re-pulse retries until approval.', kind: 'scenario', config: {} },
    { id: 'first', label: 'Approved first time', description: 'Straight through.', kind: 'scenario', config: { approveAfter: '1' } },
    { id: 'never', label: 'Never approved', description: 'Attempts exhausted, escalation.', kind: 'failure', config: { approveAfter: 'never' } },
    { id: 'typo', label: 'Missing label', description: 'Typo: downstream never triggers.', kind: 'failure', config: { typo: true } },
    { id: 'race', label: 'Concurrent triggers', description: 'Duplicate commits.', kind: 'failure', config: { race: true } },
    { id: 'bypass', label: 'Escalation bypass', description: 'Operator approves early.', kind: 'failure', config: { bypass: true } },
  ],
  comparePresets: [
    { id: 'cap', label: 'Cap 3 vs cap 5', description: 'A PR approved on the fifth review.', a: { label: 'MAX 3 (impl)', config: { approveAfter: '5' } }, b: { label: 'MAX 5', config: { approveAfter: '5', maxAttempts: 5 } } },
  ],
  state: [{ key: 'labels', label: 'Labels on PR #42 (the state)', empty: 'none' }],
};
