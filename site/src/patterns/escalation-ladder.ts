import { Recorder } from '../engine/recorder';
import { chance, rand } from '../engine/rng';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';
import { checkModelAnswer, deterministic, type Hunk } from './ports';

const n = (c: Config, k: string) => Number(c[k]);

/** Synthetic hunks: a share is exactly solvable (identical sides, one side unchanged), the rest are real conflicts. */
export function hunks(c: Config, seed: number): Hunk[] {
  return Array.from({ length: n(c, 'hunks') }, (_, i) => {
    if (chance(n(c, 'structural') / 100, seed, 'kind', i)) {
      return rand(seed, 'sub', i) < 0.5 ? { ours: `x${i}`, base: `x${i}`, theirs: `x${i}-2` } : { ours: `y${i}`, base: `b${i}`, theirs: `y${i}` };
    }
    return { ours: `- ours ${i}`, base: '', theirs: `- theirs ${i}` };
  });
}

/** The stand-in model: the union of both sides, or a bad answer per the configured quality. */
function modelAnswer(c: Config, seed: number, i: number, h: Hunk): string {
  if (!chance(n(c, 'bad') / 100, seed, 'bad', i)) return `${h.theirs}\n${h.ours}`;
  return c.badKind === 'marker' ? `<<<<<<< ours\n${h.ours}\n=======\n${h.theirs}` : '- made up\n- also made up';
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const list = hunks(c, seed);
  r.set('hunks', list.map((_, i) => `#${i + 1}|muted`)).node('item', 'ok', `${list.length} hunks`).log(`Conflicted file: ${list.length} hunks`, 'muted', 'item');
  r.transit('item-breaker', 300).node('breaker', 'active').wait(200);
  if (c.previous && !c.manual) {
    r.node('breaker', 'fail', 'circuit open').log('Same conflict signature already escalated: a loop does not try again', 'fail', 'breaker');
    r.transit('breaker-human', 500, { tone: 'fail' }).node('human', 'waiting', 'circuit_open');
    return r.end('ESCALATED — circuit_open', 'violet');
  }
  r.node('breaker', 'ok', c.manual ? 'manual override' : 'new signature').transit('breaker-unit', 300);
  r.run('unit', 300, 'ok', 'per hunk').log('Split into the smallest unit: one hunk, never the file', 'info', 'unit');
  const marks = list.map((_, i) => `#${i + 1}|muted`);
  for (const [i, h] of list.entries()) {
    r.node('det', 'active', `#${i + 1}`).transit(i === 0 ? 'unit-det' : 'next-det', 250).wait(150);
    if (deterministic(h) !== null) {
      r.node('det', 'ok', `#${i + 1} free`).count('free').log(`Hunk #${i + 1}: resolved deterministically (${h.ours === h.theirs ? 'identical sides' : 'one side unchanged'}) — no model call`, 'ok', 'det');
      marks[i] = `#${i + 1} code|ok`;
      r.set('hunks', [...marks]).transit('det-next', 250);
    } else {
      r.node('det', 'warn', `#${i + 1}`).transit('det-model', 250);
      if (!c.model) {
        r.node('model', 'skipped').log('No model configured → escalate', 'fail', 'model').transit('model-human', 500, { tone: 'fail' }).node('human', 'waiting', 'no_model');
        marks[i] = `#${i + 1} no_model|fail`;
        r.set('hunks', [...marks]);
        return r.end(`ESCALATED — no_model (hunk ${i + 1})`, 'violet');
      }
      r.node('model', 'active', `#${i + 1}`).log(`Hunk #${i + 1}: real conflict → model gets the three sides of this hunk only`, 'info', 'model').wait(1100).count('modelCalls').count('tokens', 900);
      r.node('model', 'ok').transit('model-check', 250).node('check', 'active').wait(150);
      const refused = checkModelAnswer(h, modelAnswer(c, seed, i, h));
      if (refused) {
        r.node('check', 'fail', refused).log(`Post-check in code: ${refused} → the whole file escalates (all or nothing)`, 'fail', 'check');
        marks[i] = `#${i + 1} ${refused}|fail`;
        r.set('hunks', [...marks]).transit('check-human', 500, { tone: 'fail' }).node('human', 'waiting', refused);
        return r.end(`ESCALATED — ${refused} (hunk ${i + 1})`, 'violet');
      }
      r.node('check', 'ok').log('Post-check passes: no marker, nothing invented', 'ok', 'check');
      marks[i] = `#${i + 1} model|accent`;
      r.set('hunks', [...marks]).transit('check-next', 250);
    }
    r.node('next', 'ok', `${i + 1}/${list.length}`).wait(100);
  }
  r.transit('next-apply', 300, { tone: 'ok' }).node('apply', 'ok', 'all hunks').log('Apply all — the file is never half-merged', 'ok', 'apply');
  return r.end('RESOLVED', 'ok');
}

export const escalationLadder: PatternSim = {
  slug: 'escalation-ladder',
  invariant: 'Cheapest exact rung first, the model only on the smallest unit with a post-check in code, a human last — with a closed reason code.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 1.5,
  params: [
    { key: 'hunks', label: 'Conflict hunks', type: 'number', min: 1, max: 8, step: 1, default: 5 },
    { key: 'structural', label: 'Exactly solvable share', type: 'number', min: 0, max: 100, step: 10, default: 60, unit: '%', help: 'Identical sides or one side unchanged since the base.' },
    { key: 'model', label: 'Model rung available', type: 'toggle', default: true },
    { key: 'bad', label: 'Bad model answers', type: 'number', min: 0, max: 100, step: 5, default: 10, unit: '%', visibleIf: (c) => c.model !== false },
    { key: 'badKind', label: 'Bad answer kind', type: 'select', default: 'invented', visibleIf: (c) => c.model !== false, options: [{ value: 'invented', label: 'Invents lines' }, { value: 'marker', label: 'Leaves a marker' }] },
    { key: 'previous', label: 'Same conflict already escalated', type: 'toggle', default: false },
    { key: 'manual', label: 'Manual override (a person retries)', type: 'toggle', default: false, visibleIf: (c) => c.previous === true },
  ],
  graph: () => ({
    nodes: [
      { id: 'item', label: 'Work item', kind: 'start', rank: 0, lane: 0 },
      { id: 'breaker', label: 'Same failure?', sub: 'breaker', kind: 'gate', rank: 1, lane: 0 },
      { id: 'unit', label: 'Smallest unit', sub: 'one hunk', kind: 'agent', rank: 2, lane: 0 },
      { id: 'det', label: 'Deterministic?', sub: 'rung 1, free', kind: 'gate', rank: 3, lane: 0 },
      { id: 'model', label: 'Model rung', sub: 'one hunk', kind: 'agent', rank: 3, lane: 1 },
      { id: 'check', label: 'Post-check', sub: 'in code', kind: 'gate', rank: 4, lane: 1 },
      { id: 'next', label: 'More units?', kind: 'gate', rank: 4, lane: 0 },
      { id: 'apply', label: 'Apply all', kind: 'end', rank: 5, lane: 0 },
      { id: 'human', label: 'Human', sub: 'reason code', kind: 'human', rank: 5, lane: 1 },
    ],
    edges: [
      { id: 'item-breaker', from: 'item', to: 'breaker' },
      { id: 'breaker-unit', from: 'breaker', to: 'unit', label: 'no' },
      { id: 'breaker-human', from: 'breaker', to: 'human', side: 'near', label: 'yes', depth: 30 },
      { id: 'unit-det', from: 'unit', to: 'det' },
      { id: 'det-next', from: 'det', to: 'next', label: 'yes' },
      { id: 'det-model', from: 'det', to: 'model', label: 'no' },
      { id: 'model-check', from: 'model', to: 'check' },
      { id: 'model-human', from: 'model', to: 'human', side: 'near', dashed: true, label: 'no model' },
      { id: 'check-next', from: 'check', to: 'next', label: 'pass' },
      { id: 'check-human', from: 'check', to: 'human', label: 'fail' },
      { id: 'next-det', from: 'next', to: 'det', side: 'far', label: 'yes' },
      { id: 'next-apply', from: 'next', to: 'apply', label: 'no' },
    ],
  }),
  simulate,
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'free', label: 'Hunks resolved by code', format: 'int', better: 'higher' },
    { key: 'modelCalls', label: 'Model calls', format: 'int', better: 'lower' },
    { key: 'tokens', label: 'Simulated tokens', format: 'units', better: 'lower' },
  ],
  derive: (t: Trace) => ({ outcome: t.outcome?.label ?? '—', free: t.counters.free ?? 0, modelCalls: t.counters.modelCalls ?? 0, tokens: t.counters.tokens ?? 0 }),
  explain: (t, c) => {
    const out: string[] = [];
    out.push(`${t.counters.free ?? 0} hunk(s) cost nothing: code resolved them exactly, the model never saw them.`);
    const label = t.outcome?.label ?? '';
    if (label.includes('invented_content') || label.includes('marker_left')) out.push('The post-check refused one model answer and the whole file escalated: a half-merged file is never returned. The reason is a code a dashboard can count — no model text in the record.');
    if (label.includes('circuit_open')) out.push('The breaker keys on the conflict signature, not the attempt count: the same conflict is not retried by a loop. A person can override it.');
    if (label.includes('no_model')) out.push('No model rung: everything that code cannot solve goes straight to a person.');
    void c;
    return out;
  },
  compare: (a, b) => metricDeltas(escalationLadder.metrics, a, b),
  presets: [
    { id: 'default', label: 'Mixed conflict', description: 'Free rungs, model rung, all checks pass.', kind: 'scenario', config: {}, seed: 7 },
    { id: 'invented', label: 'Model invents content', description: 'Post-check refuses → escalate.', kind: 'failure', config: { bad: 100 } },
    { id: 'marker', label: 'Marker left', description: 'A conflict marker in the answer.', kind: 'failure', config: { bad: 100, badKind: 'marker' } },
    { id: 'breaker', label: 'Circuit open', description: 'Same conflict already escalated.', kind: 'failure', config: { previous: true } },
  ],
  comparePresets: [
    { id: 'structural', label: 'Mostly structural vs mostly judgement', description: 'Where the ladder pays off.', a: { label: '20 % solvable by code', config: { structural: 20, hunks: 8 } }, b: { label: '80 % solvable by code', config: { structural: 80, hunks: 8 } } },
  ],
  state: [{ key: 'hunks', label: 'Hunks — rung used', empty: '—' }],
};
