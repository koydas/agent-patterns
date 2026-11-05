import { Recorder } from '../engine/recorder';
import { chance } from '../engine/rng';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);
const NITS = ['naming', 'error-handling', 'test-style', 'logging', 'imports', 'docs'];

export function evolve(c: Config, seed: number) {
  const runs = n(c, 'runs');
  const good = new Set<string>();
  const bad: string[] = [];
  let lines = 0;
  const history: { nits: number; rules: number; bad: number; pruned: boolean }[] = [];
  for (let k = 1; k <= runs; k++) {
    const nits = NITS.filter((x) => !good.has(x)).length;
    history.push({ nits, rules: good.size + bad.length, bad: bad.length, pruned: false });
    if (k === runs) break; // the last run's feedback is never learned: simulate() records no learn step after it
    // learn step: one rule per recurring nit
    for (const x of NITS) {
      if (good.has(x)) continue;
      if (!chance(0.5, seed, 'learn', k, x)) continue; // feedback captured this run
      if (chance(n(c, 'misread') / 100, seed, 'misread', k, x)) {
        if (c.review && chance(0.8, seed, 'review', k, x)) continue; // a human reviews the CLAUDE.md diff and rejects it
        bad.push(`${x}→over-generalised`);
      } else good.add(x);
      lines += 3;
    }
    if (c.prune && lines > n(c, 'budget')) { lines = Math.round(n(c, 'budget') * 0.7); history[k - 1].pruned = true; bad.splice(0, Math.ceil(bad.length / 2)); }
  }
  return { history, good: [...good], bad, lines };
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const e = evolve(c, seed);
  e.history.forEach((h, i) => {
    const k = i + 1;
    for (const id of ['run', 'output', 'feedback', 'learn', 'persist']) r.node(id, 'idle', null);
    r.set('run', `${k}/${e.history.length}`).node('run', 'active', `run ${k}`).log(`Run ${k}: loads CLAUDE.md (${h.rules} learned rules${h.bad ? `, ${h.bad} wrong` : ''})`, 'info', 'run').wait(500).node('run', 'ok');
    r.transit('run-output', 250).run('output', 500, 'ok').transit('output-feedback', 250);
    r.run('feedback', 600, h.nits ? 'warn' : 'ok', `${h.nits} nits`).count('nits', h.nits).log(`Human review: ${h.nits} recurring nit(s)`, h.nits ? 'warn' : 'ok', 'feedback');
    if (k === e.history.length) return;
    r.transit('feedback-learn', 250).run('learn', 700).count('calls').transit('learn-persist', 250);
    r.run('persist', 400, c.review ? 'ok' : 'warn', c.review ? 'diff reviewed' : 'appended').log(c.review ? 'Rules appended — the CLAUDE.md diff is reviewed before commit' : 'Rules appended to CLAUDE.md, no review', 'muted', 'persist');
    if (h.pruned) r.log('Prune agent consolidates CLAUDE.md under its line budget', 'info', 'persist');
    r.transit('persist-run', 400, { label: 'next run' });
  });
  r.set('rules', [...e.good.map((g) => `${g}|ok`), ...e.bad.map((b) => `${b}|fail`)]);
  return r.end(e.bad.length ? `${e.bad.length} wrong rule(s) persisted` : `${e.good.length} rules learned`, e.bad.length ? 'warn' : 'ok');
}

export const reflexiveLoop: PatternSim = {
  slug: 'reflexive-loop',
  invariant: 'Feedback becomes persistent rules loaded by every later run — so a wrong rule persists too. Reference only: no repo runs the learn step yet.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 1.5,
  params: [
    { key: 'runs', label: 'Pipeline runs', type: 'number', min: 2, max: 10, step: 1, default: 6 },
    { key: 'misread', label: 'Learn agent over-generalises', type: 'number', min: 0, max: 100, step: 5, default: 20, unit: '%' },
    { key: 'review', label: 'Human reviews the CLAUDE.md diff', type: 'toggle', default: false },
    { key: 'prune', label: 'Prune agent with a line budget', type: 'toggle', default: false },
    { key: 'budget', label: 'Line budget', type: 'number', min: 6, max: 30, step: 3, default: 12, visibleIf: (c) => c.prune === true },
  ],
  graph: () => ({
    nodes: [
      { id: 'run', label: 'Pipeline run', kind: 'start', rank: 0, lane: 0 },
      { id: 'output', label: 'Agent output', kind: 'agent', rank: 1, lane: 0 },
      { id: 'feedback', label: 'Human feedback', kind: 'human', rank: 2, lane: 0 },
      { id: 'learn', label: 'learn agent', sub: 'extracts rules', kind: 'agent', rank: 3, lane: 0 },
      { id: 'persist', label: 'CLAUDE.md', sub: 'append rules', kind: 'store', rank: 4, lane: 0 },
    ],
    edges: [
      { id: 'run-output', from: 'run', to: 'output' },
      { id: 'output-feedback', from: 'output', to: 'feedback' },
      { id: 'feedback-learn', from: 'feedback', to: 'learn' },
      { id: 'learn-persist', from: 'learn', to: 'persist' },
      { id: 'persist-run', from: 'persist', to: 'run', side: 'near', label: 'next run loads it' },
    ],
  }),
  simulate,
  metrics: [
    { key: 'first', label: 'Nits in run 1', format: 'int' },
    { key: 'last', label: 'Nits in the last run', format: 'int', better: 'lower' },
    { key: 'rules', label: 'Rules persisted', format: 'int' },
    { key: 'bad', label: 'Wrong rules persisted', format: 'int', better: 'lower' },
    { key: 'lines', label: 'CLAUDE.md lines added', format: 'int', better: 'lower' },
  ],
  derive: (t: Trace, c, seed) => {
    const e = evolve(c, seed);
    const done = !!t.outcome;
    return { first: e.history[0].nits, last: done ? e.history[e.history.length - 1].nits : NaN, rules: done ? e.good.length + e.bad.length : NaN, bad: done ? e.bad.length : NaN, lines: done ? e.lines : NaN };
  },
  explain: (_t, c, seed) => {
    const e = evolve(c, seed);
    const out = [`Recurring nits went from ${e.history[0].nits} to ${e.history[e.history.length - 1].nits} without editing a prompt by hand.`];
    if (e.bad.length) out.push(`${e.bad.length} over-generalised rule(s) were written and are now loaded on every run: garbage in, garbage persists.`);
    if (c.review) out.push('Reviewing the CLAUDE.md diff caught most wrong rules before they were committed.');
    if (c.prune) out.push('Pruning kept the file under its budget, at the cost of another agent pass.');
    out.push('Reference only — see read-only-meta-loop for the counterpart that writes nothing.');
    return out;
  },
  compare: (a, b) => metricDeltas(reflexiveLoop.metrics, a, b),
  presets: [
    { id: 'default', label: 'Unreviewed learning', description: 'Rules appended as extracted.', kind: 'scenario', config: {} },
    { id: 'reviewed', label: 'Reviewed + pruned', description: 'The README mitigations.', kind: 'scenario', config: { review: true, prune: true } },
    { id: 'misread', label: 'Feedback misinterpretation', description: '60 % over-generalisation.', kind: 'failure', config: { misread: 60 } },
  ],
  comparePresets: [
    { id: 'review', label: 'Unreviewed vs reviewed', description: 'Same feedback, same learn agent.', a: { label: 'Appended as extracted', config: { misread: 40 } }, b: { label: 'Diff reviewed before commit', config: { misread: 40, review: true } } },
  ],
  state: [{ key: 'run', label: 'Run' }, { key: 'rules', label: 'Learned rules (CLAUDE.md)', empty: 'appear at the end' }],
};
