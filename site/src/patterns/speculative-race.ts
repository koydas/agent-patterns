import { Recorder } from '../engine/recorder';
import { chance, jitter } from '../engine/rng';
import { metricDeltas, plural } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const NAMES = ['minimal', 'robust', 'refactor', 'strategy-4'];
const n = (c: Config, k: string) => Number(c[k]);
const SELECTOR_MS = 600;

interface Attempt { i: number; ok: boolean; hang: boolean; settle: number; cause: string }

export function attempts(c: Config, seed: number): Attempt[] {
  const k = n(c, 'strategies');
  const deadline = n(c, 'deadline');
  return Array.from({ length: k }, (_, i) => {
    const hang = c.hang === NAMES[i];
    const lat = jitter(n(c, `lat${i}`), 0.15, seed, 'lat', i);
    const failed = chance(n(c, 'failure') / 100, seed, 'fail', i);
    const passes = c.selection !== 'any' || chance(n(c, 'checkPass') / 100, seed, 'check', i);
    if (hang || lat > deadline) return { i, ok: false, hang: true, settle: deadline, cause: hang ? 'hangs → aborted at its deadline' : 'too slow → aborted at its deadline' };
    if (failed) return { i, ok: false, hang: false, settle: Math.round(lat * 0.6), cause: 'rejected (simulated failure)' };
    if (!passes) return { i, ok: false, hang: false, settle: lat, cause: 'finished, but its pass/fail check failed' };
    return { i, ok: true, hang: false, settle: lat, cause: 'fulfilled' };
  });
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const list = attempts(c, seed);
  const any = c.selection === 'any';
  r.node('input', 'ok').log(`${plural(list.length, 'strategy', 'strategies')} launched in parallel, each with its own ${n(c, 'deadline')} ms deadline`, 'muted', 'input');
  for (const a of list) {
    r.transit(`input-s${a.i}`, 250, { t: 0 });
    r.node(`s${a.i}`, 'active', null, 250).count('started', 1, 250);
  }
  const winner = any ? list.filter((a) => a.ok).sort((x, y) => x.settle - y.settle)[0] : null;
  const cutoff = any && winner && c.abort ? winner.settle + 250 : Infinity;
  for (const a of list) {
    const t = a.settle + 250;
    if (t > cutoff && a !== winner) {
      r.node(`s${a.i}`, 'skipped', 'aborted', cutoff).log(`${NAMES[a.i]}: aborted after the winner (AbortSignal)`, 'muted', `s${a.i}`, cutoff);
      r.count('busy', cutoff - 250, cutoff); // paid until the abort lands
      continue;
    }
    r.count('busy', a.settle, t); // paid as each strategy settles, never ahead of the playback
    r.node(`s${a.i}`, a.ok ? 'ok' : a.hang ? 'warn' : 'fail', a.ok ? `${a.settle} ms` : a.hang ? 'timeout' : 'failed', t);
    r.log(`${NAMES[a.i]}: ${a.cause}`, a.ok ? 'ok' : 'fail', `s${a.i}`, t);
    if (a.ok) r.transit(`s${a.i}-selector`, 300, { t, tone: 'ok' }).count('candidates', 1, t);
  }
  const ok = list.filter((a) => a.ok);
  if (any) {
    if (!winner) { r.at(Math.max(...list.map((a) => a.settle)) + 250).node('selector', 'fail').log('Promise.any rejects with AggregateError: every strategy failed', 'fail', 'selector'); return r.end('FAILED — every strategy failed', 'fail'); }
    r.at(winner.settle + 550).node('selector', 'ok', NAMES[winner.i]).log(`Promise.any resolves with the first success: ${NAMES[winner.i]} — no ranking`, 'ok', 'selector');
    r.transit('selector-done', 300, { tone: 'ok' }).node('done', 'ok').set('resultAt', r.now);
    if (!c.abort) r.at(Math.max(...list.map((a) => a.settle)) + 250).log('Losers were not aborted: they ran (and billed) to the end', 'warn');
    return r.end(`First valid: ${NAMES[winner.i]}`, 'ok');
  }
  const all = Math.max(...list.map((a) => a.settle)) + 550;
  if (!ok.length) { r.at(all).node('selector', 'fail').log('All strategies failed — nothing to select from (the impl throws)', 'fail', 'selector'); return r.end('FAILED — no candidate', 'fail'); }
  r.at(all).node('selector', 'active', `${ok.length}/${list.length}`).log(ok.length < list.length ? `allSettled: degraded, ${ok.length}/${list.length} candidates` : `allSettled: ${ok.length} candidates reach the selector`, ok.length < list.length ? 'warn' : 'info', 'selector');
  r.wait(SELECTOR_MS).count('selector');
  const pick = ok[0];
  r.node('selector', 'ok', NAMES[pick.i]).log(`Selector picks ${NAMES[pick.i]} (mock selector: first candidate)`, 'ok', 'selector');
  r.transit('selector-done', 300, { tone: 'ok' }).node('done', ok.length < list.length ? 'warn' : 'ok').set('resultAt', r.now);
  return r.end(ok.length < list.length ? `Selected ${NAMES[pick.i]} — degraded ${ok.length}/${list.length}` : `Selected ${NAMES[pick.i]} of ${ok.length}`, ok.length < list.length ? 'warn' : 'ok');
}

export const speculativeRace: PatternSim = {
  slug: 'speculative-race',
  invariant: 'Strategies run in parallel under per-strategy deadlines; failures are filtered, never fatal, and every strategy is paid for.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 1.2,
  params: [
    { key: 'strategies', label: 'Strategies', type: 'number', min: 2, max: 4, step: 1, default: 3, source: 'impl: minimal, robust, refactor · README: gate N to 2–4' },
    ...[0, 1, 2, 3].map((i) => ({ key: `lat${i}`, label: `${NAMES[i]} latency`, type: 'number' as const, min: 200, max: 4000, step: 100, default: [900, 1600, 2200, 1300][i], unit: 'ms' as const, visibleIf: (c: Config) => Number(c.strategies) > i })),
    { key: 'deadline', label: 'Per-strategy deadline', type: 'number', min: 500, max: 5000, step: 100, default: 2000, unit: 'ms', source: 'impl: STRATEGY_TIMEOUT_MS = 2000' },
    { key: 'failure', label: 'Failure probability', type: 'number', min: 0, max: 100, step: 5, default: 15, unit: '%' },
    { key: 'hang', label: 'Hanging strategy', type: 'select', default: 'none', source: 'impl: HANG_STRATEGY', options: [{ value: 'none', label: 'None' }, ...NAMES.slice(0, 3).map((x) => ({ value: x, label: x }))] },
    { key: 'selection', label: 'Selection', type: 'select', default: 'settled', options: [
      { value: 'settled', label: 'allSettled + selector (impl)', note: 'run all, select best' },
      { value: 'any', label: 'Promise.any — first success', note: 'README variant: interchangeable candidates, each ends in a pass/fail check' },
    ] },
    { key: 'checkPass', label: 'Validation pass rate', type: 'number', min: 0, max: 100, step: 5, default: 70, unit: '%', help: 'Strictness of each candidate\'s pass/fail check (e.g. tests pass).', visibleIf: (c) => c.selection === 'any' },
    { key: 'abort', label: 'Abort losers after the winner', type: 'toggle', default: true, help: 'Promise.any does not stop the others unless each gets an AbortSignal.', visibleIf: (c) => c.selection === 'any' },
  ],
  graph: (c) => {
    const k = n(c, 'strategies');
    const mid = (k - 1) / 2;
    return {
      nodes: [
        { id: 'input', label: 'Task input', kind: 'start', rank: 0, lane: mid },
        ...Array.from({ length: k }, (_, i) => ({ id: `s${i}`, label: NAMES[i], sub: 'strategy agent', kind: 'agent' as const, rank: 1, lane: i })),
        { id: 'selector', label: c.selection === 'any' ? 'First success' : 'Selector', sub: c.selection === 'any' ? 'Promise.any' : 'agent', kind: 'gate', rank: 2, lane: mid },
        { id: 'done', label: 'Result', kind: 'end', rank: 3, lane: mid },
      ],
      edges: [
        ...Array.from({ length: k }, (_, i) => ({ id: `input-s${i}`, from: 'input', to: `s${i}` })),
        ...Array.from({ length: k }, (_, i) => ({ id: `s${i}-selector`, from: `s${i}`, to: 'selector' })),
        { id: 'selector-done', from: 'selector', to: 'done' },
      ],
    };
  },
  simulate,
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'duration', label: 'Time to result', format: 'ms', better: 'lower' },
    { key: 'candidates', label: 'Valid candidates', format: 'int', better: 'higher' },
    { key: 'busy', label: 'Strategy time paid', format: 'ms', better: 'lower', hint: 'Sum of running time of every strategy: the cost side of the race.' },
    { key: 'calls', label: 'Agent calls', format: 'int', better: 'lower' },
  ],
  derive: (t: Trace) => ({
    outcome: t.outcome?.label ?? '—',
    // when the result exists, not when the last loser stops: background losers must not inflate it
    duration: typeof t.vars.resultAt === 'number' ? t.vars.resultAt : t.duration,
    candidates: t.counters.candidates ?? 0, // settled successfully in this run; aborted strategies produced nothing
    busy: t.counters.busy ?? 0,
    calls: (t.counters.started ?? 0) + (t.counters.selector ?? 0),
  }),
  explain: (t, c, seed) => {
    const list = attempts(c, seed);
    const out: string[] = [];
    const hung = list.filter((a) => a.hang);
    if (hung.length) out.push(`${hung.map((a) => NAMES[a.i]).join(', ')} never answered in time: the per-strategy deadline stopped ${hung.length === 1 ? 'it' : 'them'} from blocking the selector.`);
    if (c.selection === 'any') out.push(c.abort ? 'Promise.any returned the first valid candidate and the losers were aborted: lowest latency, but nothing compares quality.' : 'Promise.any returned the first valid candidate, but without aborting the losers you still paid for every strategy.');
    else out.push(`allSettled waited for every strategy: time to result is the slowest one (or its deadline), and cost is the sum of all ${list.length}.`);
    const ok = list.filter((a) => a.ok).length;
    if (ok && ok < list.length && c.selection !== 'any') out.push(`Degraded run: with ${ok} of ${list.length} candidates the selector has ${ok === 1 ? 'nothing to choose between' : 'less diversity'}.`);
    void t;
    return out;
  },
  compare: (a, b) => {
    const out: string[] = [];
    if (a.config.selection !== b.config.selection) out.push(`First-valid selection traded ranking for latency: ${(Number(a.metrics.duration) / 1000).toFixed(2)} s vs ${(Number(b.metrics.duration) / 1000).toFixed(2)} s to a result, ${(Number(a.metrics.busy) / 1000).toFixed(1)} s vs ${(Number(b.metrics.busy) / 1000).toFixed(1)} s of strategy time paid.`);
    return [...out, ...metricDeltas(speculativeRace.metrics, a, b)];
  },
  presets: [
    { id: 'default', label: 'Default (impl)', description: '3 strategies, allSettled, 2 s deadline.', kind: 'scenario', config: {} },
    { id: 'any', label: 'First valid wins', description: 'Promise.any with a pass/fail check, losers aborted.', kind: 'scenario', config: { selection: 'any' } },
    { id: 'hang', label: 'One strategy hangs', description: 'HANG_STRATEGY=refactor: the deadline saves the run.', kind: 'failure', config: { hang: 'refactor', failure: 0 } },
    { id: 'allfail', label: 'Every strategy fails', description: 'Nothing to select from.', kind: 'failure', config: { failure: 100 } },
    { id: 'noabort', label: 'No abort on losers', description: 'Promise.any without AbortSignal: N × cost anyway.', kind: 'failure', config: { selection: 'any', abort: false, failure: 0, checkPass: 100 } },
  ],
  phases: [{ label: 'Launch', nodes: ['input'] }, { label: 'Race', nodes: ['s0', 's1', 's2', 's3'] }, { label: 'Select', nodes: ['selector'] }, { label: 'Result', nodes: ['done'] }],
  comparePresets: [
    { id: 'settled-any', label: 'Select best vs first valid', description: 'Same strategies and draws; latency vs cost.', a: { label: 'allSettled + selector', config: { failure: 0 } }, b: { label: 'Promise.any + abort', config: { failure: 0, selection: 'any', checkPass: 100 } } },
    { id: 'n', label: '2 vs 4 strategies', description: 'More diversity, more cost.', a: { label: '2 strategies', config: { strategies: 2 } }, b: { label: '4 strategies', config: { strategies: 4 } } },
  ],
};
