import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';
// The real floor comparator from the repository (pure).
import { checkRatchet } from '../../../patterns/eval-gate-ratchet/impl.mjs';

const n = (c: Config, k: string) => Number(c[k]);
const FLOOR = {
  metrics: [{ id: 'accuracy', min: 0.8, optional: false }, { id: 'false_valid_rate', max: 0.1, optional: false }],
  cases: [{ id: 'c1', label: 'VALID', inputHash: 'a1' }, { id: 'c2', label: 'NEEDS_REFINEMENT', inputHash: 'b2' }, { id: 'c3', label: 'NEEDS_REFINEMENT', inputHash: 'c3' }],
};

export function proposed(c: Config) {
  const cases = FLOOR.cases.filter((x) => !(c.removeCase && x.id === 'c3')).map((x) => ({
    ...x,
    label: c.relabel && x.id === 'c2' ? 'VALID' : x.label,
    knownGap: c.knownGap && x.id === 'c1' ? true : undefined,
  }));
  if (c.addCase) cases.push({ id: 'c4', label: 'NEEDS_REFINEMENT', inputHash: 'd4', knownGap: undefined });
  return {
    metrics: [
      { id: 'accuracy', min: n(c, 'min') / 100, optional: c.optional ? true : false },
      { id: 'false_valid_rate', max: n(c, 'max') / 100, optional: false },
    ],
    cases,
    filtered: c.filtered === true,
  };
}

function simulate(c: Config) {
  const r = new Recorder();
  const p = proposed(c);
  const res = checkRatchet(FLOOR, p) as { ok: boolean; failures: string[] };
  const score = n(c, 'score');
  r.set('failures', []).node('change', 'ok', 'prompt / eval').log('An agent changes a stage prompt — and maybe the eval config', 'muted', 'change');
  r.transit('change-floor', 300).node('floor', 'active').wait(400).log('Floor check: pinned thresholds, optional flags, case ids, labels, input hashes, full-suite run', 'info', 'floor');
  if (!res.ok) {
    r.node('floor', 'fail', `${res.failures.length} violation(s)`).set('failures', res.failures.map((f) => `${f}|fail`));
    for (const f of res.failures) r.log(`checkRatchet: ${f}`, 'fail', 'floor');
    r.transit('floor-block', 400, { tone: 'fail' }).node('block', 'fail');
    return r.end('BLOCKED — the gate was weakened', 'fail');
  }
  r.node('floor', 'ok', 'preserved').set('failures', ['none — thresholds only tightened|ok']);
  if (c.addCase || n(c, 'min') > 80 || n(c, 'max') < 10) r.log('Tightening and adding cases are allowed', 'ok', 'floor');
  for (let attempt = 1; ; attempt++) {
    const s = Math.min(100, score + (attempt - 1) * n(c, 'fixGain'));
    r.transit('floor-eval', 300).node('eval', 'active', `run ${attempt}`).wait(900).count('evalRuns');
    if (s >= n(c, 'min')) {
      r.node('eval', 'ok', `${s}% ≥ ${n(c, 'min')}%`).log(`Full suite: accuracy ${s}% ≥ min ${n(c, 'min')}%`, 'ok', 'eval');
      r.transit('eval-review', 400, { tone: 'ok' }).node('review', 'waiting');
      return r.end(attempt === 1 ? 'GREEN — to human review' : `GREEN after ${attempt - 1} fix(es) in the stage`, 'ok');
    }
    r.node('eval', 'fail', `${s}% < ${n(c, 'min')}%`).log(`Accuracy ${s}% < ${n(c, 'min')}% → fix the stage (prompt, parser, code), not the gate`, 'warn', 'eval');
    if (attempt > 4 || n(c, 'fixGain') === 0) {
      r.log('Still red: a harder suite can stay red while a real fix is developed', 'warn', 'eval');
      return r.end('RED — the stage is not good enough yet', 'warn');
    }
    r.transit('eval-fix', 300, { tone: 'warn' }).run('fix', 900, 'ok', `fix ${attempt}`).count('fixes').transit('fix-eval', 300, { tone: 'warn' });
  }
}

export const evalGateRatchet: PatternSim = {
  slug: 'eval-gate-ratchet',
  invariant: 'Thresholds only tighten and cases only grow: a red eval is fixed in the stage, never by weakening the gate.',
  timeUnit: 'steps',
  stochastic: false,
  timeScale: 1.4,
  params: [
    { key: 'score', label: 'Stage accuracy before fixes', type: 'number', min: 50, max: 100, step: 1, default: 74, unit: '%' },
    { key: 'fixGain', label: 'Gain per fix in the stage', type: 'number', min: 0, max: 10, step: 1, default: 4, unit: '%' },
    { key: 'min', label: 'Proposed accuracy min (floor 80)', type: 'number', min: 60, max: 95, step: 1, default: 80, unit: '%' },
    { key: 'max', label: 'Proposed false-valid max (floor 10)', type: 'number', min: 2, max: 30, step: 1, default: 10, unit: '%' },
    { key: 'optional', label: 'Mark accuracy optional', type: 'toggle', default: false },
    { key: 'removeCase', label: 'Remove a failing case', type: 'toggle', default: false },
    { key: 'relabel', label: 'Relabel a case', type: 'toggle', default: false },
    { key: 'knownGap', label: 'Tag a gated case known-gap', type: 'toggle', default: false },
    { key: 'filtered', label: 'Run a filtered subset (--tags)', type: 'toggle', default: false },
    { key: 'addCase', label: 'Add a new case', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'change', label: 'Agent change', kind: 'start', rank: 0, lane: 0 },
      { id: 'floor', label: 'Floor check', sub: 'checkRatchet()', kind: 'gate', rank: 1, lane: 0 },
      { id: 'block', label: 'Block the change', kind: 'fail', rank: 2, lane: 1 },
      { id: 'eval', label: 'Full evaluation', sub: 'thresholds met?', kind: 'gate', rank: 2, lane: 0 },
      { id: 'fix', label: 'Improve the stage', kind: 'agent', rank: 3, lane: 1 },
      { id: 'review', label: 'Human review', kind: 'human', rank: 3, lane: 0 },
    ],
    edges: [
      { id: 'change-floor', from: 'change', to: 'floor' },
      { id: 'floor-block', from: 'floor', to: 'block', label: 'weakened' },
      { id: 'floor-eval', from: 'floor', to: 'eval', label: 'preserved' },
      { id: 'eval-review', from: 'eval', to: 'review', label: 'yes' },
      { id: 'eval-fix', from: 'eval', to: 'fix', label: 'no' },
      { id: 'fix-eval', from: 'fix', to: 'eval', side: 'near', label: 'rerun' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'violations', label: 'Ratchet violations', format: 'int', better: 'lower' },
    { key: 'evalRuns', label: 'Full eval runs', format: 'int' },
    { key: 'fixes', label: 'Fixes in the stage', format: 'int' },
  ],
  derive: (t: Trace, c) => ({ outcome: t.outcome?.label ?? '—', violations: (checkRatchet(FLOOR, proposed(c)) as { failures: string[] }).failures.length, evalRuns: t.counters.evalRuns ?? 0, fixes: t.counters.fixes ?? 0 }),
  explain: (t) => {
    const label = t.outcome?.label ?? '';
    const out = ['Decided by the repository\'s own checkRatchet() — imported from patterns/eval-gate-ratchet/impl.mjs.'];
    if (label.startsWith('BLOCKED')) out.push('Every way to turn the signal green without improving the stage was refused: lower min, higher max, optional metric, dropped or relabelled case, known-gap on a gated case, filtered run.');
    else if (label.includes('fix')) out.push('The red eval was made green the expensive way: by improving the stage, under the same thresholds.');
    if (label.startsWith('RED')) out.push('A ratchet makes green meaningful — and can keep a suite red while the real fix is not there yet. A dataset correction needs its own reviewed change.');
    return out;
  },
  compare: (a, b) => [`A: ${a.metrics.outcome}. B: ${b.metrics.outcome}.`],
  presets: [
    { id: 'default', label: 'Fix in the stage', description: '74 % → fixes until ≥ 80 %.', kind: 'scenario', config: {} },
    { id: 'tighten', label: 'Tighten + add a case', description: 'Allowed.', kind: 'scenario', config: { min: 82, addCase: true, score: 85 } },
    { id: 'lower', label: 'Lower the minimum', description: 'min 80 → 70.', kind: 'failure', config: { min: 70 } },
    { id: 'drop', label: 'Drop / relabel cases', description: 'Dataset weakened.', kind: 'failure', config: { removeCase: true, relabel: true } },
    { id: 'filter', label: 'Filtered run', description: '--tags subset.', kind: 'failure', config: { filtered: true } },
  ],
  comparePresets: [
    { id: 'cheat', label: 'Weaken the gate vs fix the stage', description: 'Same 74 % stage.', a: { label: 'Lower min to 70', config: { min: 70 } }, b: { label: 'Keep min 80, fix the stage', config: {} } },
  ],
  state: [{ key: 'failures', label: 'checkRatchet() failures', empty: 'not checked yet' }],
};
