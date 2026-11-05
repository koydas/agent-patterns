import { Recorder } from '../engine/recorder';
import { chance, jitter } from '../engine/rng';
import { metricDeltas, plural } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);
const AGG_MS = 400;

interface Plan { i: number; slot: number; start: number; end: number; failed: boolean }

/** Greedy list scheduling of subtasks onto `workers` slots. Deterministic. */
export function schedule(c: Config, seed: number): Plan[] {
  const slots = Array.from({ length: n(c, 'workers') }, () => 0);
  const out: Plan[] = [];
  for (let i = 0; i < n(c, 'tasks'); i++) {
    const slot = slots.indexOf(Math.min(...slots));
    const slow = c.slowWorker && i === 0 ? 4 : 1;
    const dur = jitter(n(c, 'latency'), n(c, 'variance') / 100, seed, 'lat', i) * slow;
    const start = slots[slot];
    out.push({ i, slot, start, end: start + dur, failed: chance(n(c, 'failure') / 100, seed, 'fail', i) });
    slots[slot] = start + dur;
  }
  return out;
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const plan = schedule(c, seed);
  const D = 150; // dispatch transit
  r.node('task', 'ok', `${plan.length} subtasks`).log(`Dispatcher splits the task into ${plural(plan.length, 'independent subtask')}, ${plural(n(c, 'workers'), 'worker')}`, 'muted', 'task');
  r.set('queued', plan.length);
  let firstFail: number | null = null;
  const busy = new Map<number, number>();
  for (const p of plan) {
    const t0 = p.start;
    // dispatch is part of the subtask's latency, and never longer than half of it: start < end always
    const d = Math.min(D, Math.floor((p.end - p.start) / 2));
    r.transit(`task-w${p.slot}`, d, { t: t0, label: `#${p.i + 1}` });
    r.node(`w${p.slot}`, 'active', `#${p.i + 1}`, t0 + d);
    r.log(`Worker ${p.slot + 1} starts subtask #${p.i + 1}`, 'info', `w${p.slot}`, t0 + d);
    r.count('started', 1, t0 + d);
    r.count('tokens', 1500, t0 + d);
    busy.set(p.slot, (busy.get(p.slot) ?? 0) + 1);
    const end = p.end;
    if (p.failed) {
      r.node(`w${p.slot}`, 'fail', `#${p.i + 1}`, end).count('failed', 1, end).log(`Subtask #${p.i + 1} failed`, 'fail', `w${p.slot}`, end);
      if (firstFail === null || end < firstFail) firstFail = end;
    } else {
      r.node(`w${p.slot}`, 'ok', `#${p.i + 1}`, end).count('completed', 1, end).log(`Subtask #${p.i + 1} done`, 'ok', `w${p.slot}`, end);
      r.transit(`w${p.slot}-agg`, D, { t: end, tone: 'ok' });
    }
  }
  const allDone = Math.max(...plan.map((p) => p.end)) + D;
  const failures = plan.filter((p) => p.failed).length;
  if (failures && c.aggregation === 'all') {
    r.at(firstFail!).node('agg', 'fail', 'rejected');
    r.log('Promise.all rejects on the first failure: the merge never runs and the other results are lost', 'fail', 'agg');
    r.at(allDone - D).log('The remaining workers still ran to completion — compute spent on discarded results', 'warn');
    return r.end(`FAILED — 1 of ${plan.length} subtasks rejected the merge`, 'fail');
  }
  r.at(allDone).node('agg', 'active', `${plan.length - failures}/${plan.length}`).log(failures ? `Aggregator merges ${plan.length - failures} of ${plan.length} results (allSettled)` : `Aggregator merges all ${plan.length} results`, failures ? 'warn' : 'info', 'agg');
  r.wait(AGG_MS).count('tokens', 2000).node('agg', failures ? 'warn' : 'ok').transit('agg-done', D, { tone: failures ? 'warn' : 'ok' });
  r.node('done', failures ? 'warn' : 'ok');
  if (failures) {
    r.log('Partial result: the summary may read complete while it is not — flag it', 'warn', 'done');
    return r.end(`PARTIAL — ${plan.length - failures}/${plan.length} subtasks merged`, 'warn');
  }
  return r.end(`Merged ${plural(plan.length, 'result')}`, 'ok');
}

const span = (plan: Plan[]) => Math.max(...plan.map((p) => p.end));
function sequential(c: Config, seed: number) {
  return span(schedule({ ...c, workers: 1 }, seed));
}

export const fanOut: PatternSim = {
  slug: 'fan-out',
  invariant: 'Wall-clock time follows the slowest worker, not the sum — and the merge waits for every worker.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 1.5,
  params: [
    { key: 'tasks', label: 'Independent subtasks', type: 'number', min: 1, max: 10, step: 1, default: 3, source: 'impl: decompose() returns 3' },
    { key: 'workers', label: 'Workers (parallel slots)', type: 'number', min: 1, max: 10, step: 1, default: 3, help: 'impl: one worker per subtask. Fewer workers than subtasks queues the rest.' },
    { key: 'latency', label: 'Worker latency', type: 'number', min: 200, max: 3000, step: 100, default: 1000, unit: 'ms', help: '±20 % per subtask.' },
    { key: 'failure', label: 'Worker failure probability', type: 'number', min: 0, max: 60, step: 5, default: 0, unit: '%' },
    { key: 'variance', label: 'Latency variance', type: 'number', min: 0, max: 50, step: 5, default: 20, unit: '%', help: '0 % = every subtask takes exactly the latency above.' },
    { key: 'slowWorker', label: 'One slow subtask (4× latency)', type: 'toggle', default: false },
    { key: 'aggregation', label: 'Aggregation', type: 'select', default: 'all', options: [
      { value: 'all', label: 'Promise.all (impl)', note: 'one failure rejects the merge' },
      { value: 'settled', label: 'allSettled + partial', note: 'merge survivors, flag the gap (README failure mode)' },
    ] },
  ],
  graph: (c) => {
    const w = n(c, 'workers');
    const mid = (w - 1) / 2;
    return {
      nodes: [
        { id: 'task', label: 'Task input', kind: 'start', rank: 0, lane: mid },
        ...Array.from({ length: w }, (_, i) => ({ id: `w${i}`, label: w > 4 ? `W${i + 1}` : `Worker ${i + 1}`, kind: 'worker' as const, rank: 1, lane: i, size: (w > 4 ? 'sm' : 'md') as 'sm' | 'md' })),
        { id: 'agg', label: 'Aggregator', sub: 'agent', kind: 'agent', rank: 2, lane: mid },
        { id: 'done', label: 'Merged output', kind: 'end', rank: 3, lane: mid },
      ],
      edges: [
        ...Array.from({ length: w }, (_, i) => ({ id: `task-w${i}`, from: 'task', to: `w${i}` })),
        ...Array.from({ length: w }, (_, i) => ({ id: `w${i}-agg`, from: `w${i}`, to: 'agg' })),
        { id: 'agg-done', from: 'agg', to: 'done' },
      ],
    };
  },
  simulate,
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'duration', label: 'Simulated elapsed time', format: 'ms', better: 'lower' },
    { key: 'span', label: 'Worker span', format: 'ms', better: 'lower', hint: 'First dispatch to last worker result.' },
    { key: 'sequential', label: 'Same subtasks, one worker', format: 'ms', estimate: true, hint: 'The same subtask latencies run back to back (same seed).' },
    { key: 'speedup', label: 'Speedup vs one worker', format: 'x', better: 'higher', estimate: true },
    { key: 'completed', label: 'Completed subtasks', format: 'int', better: 'higher' },
    { key: 'failed', label: 'Failed subtasks', format: 'int', better: 'lower' },
    { key: 'compute', label: 'Total worker time', format: 'ms', hint: 'Sum of busy time: parallelism does not reduce it.' },
    { key: 'tokens', label: 'Simulated tokens', format: 'units' },
  ],
  derive: (t: Trace, c, seed) => {
    const plan = schedule(c, seed);
    const seq = sequential(c, seed);
    return {
      outcome: t.outcome?.label ?? '—',
      duration: t.duration,
      span: t.outcome ? span(plan) : NaN,
      sequential: seq,
      speedup: t.outcome ? seq / span(plan) : NaN,
      completed: t.counters.completed ?? 0,
      failed: t.counters.failed ?? 0,
      compute: plan.reduce((s, p) => s + (p.end - p.start), 0),
      tokens: t.counters.tokens ?? 0,
    };
  },
  explain: (_t, c, seed) => {
    const plan = schedule(c, seed);
    const out: string[] = [];
    const longest = Math.max(...plan.map((p) => p.end - p.start));
    if (n(c, 'workers') >= plan.length) out.push(`All ${plan.length} subtasks ran at once: elapsed time is the slowest subtask (${(longest / 1000).toFixed(2)} s) plus dispatch and merge, not their sum.`);
    else out.push(`${n(c, 'workers')} workers for ${plan.length} subtasks: the rest queued, so elapsed time grew to about ⌈${plan.length}/${n(c, 'workers')}⌉ rounds of work.`);
    if (c.slowWorker) out.push('One slow subtask holds the whole merge: the aggregator cannot start before the last worker returns.');
    const failed = plan.filter((p) => p.failed).length;
    if (failed && c.aggregation === 'all') out.push('With Promise.all one failed worker rejected everything — and the other workers kept running and billing.');
    if (failed && c.aggregation === 'settled') out.push(`allSettled kept ${plan.length - failed} results, but the merged output is partial; an aggregator that does not know it may write a misleading summary.`);
    out.push('Parallelism shortens elapsed time; it does not reduce total worker time or tokens.');
    return out;
  },
  compare: (a, b) => {
    const out: string[] = [];
    if (a.config.workers !== b.config.workers) out.push(`Concurrency ${a.config.workers} → ${b.config.workers}: elapsed ${(Number(a.metrics.duration) / 1000).toFixed(1)} s → ${(Number(b.metrics.duration) / 1000).toFixed(1)} s, while total worker time stays ${(Number(b.metrics.compute) / 1000).toFixed(1)} s — more simultaneous resource use, not less work.`);
    if (a.config.aggregation !== b.config.aggregation) out.push('Same failing worker: Promise.all loses every result, allSettled keeps the survivors and must flag the gap.');
    return [...out, ...metricDeltas(fanOut.metrics, a, b)];
  },
  presets: [
    { id: 'default', label: 'Default (impl)', description: '3 subtasks, 3 workers.', kind: 'scenario', config: {} },
    { id: 'eight', label: '8 tasks, 4 workers', description: 'Queueing when workers < subtasks.', kind: 'scenario', config: { tasks: 8, workers: 4 } },
    { id: 'slow', label: 'Slow worker', description: 'One subtask takes 4× longer and holds the merge.', kind: 'failure', config: { slowWorker: true, tasks: 4, workers: 4 } },
    { id: 'partial', label: 'Partial failure', description: 'A worker fails: Promise.all drops everything.', kind: 'failure', config: { tasks: 5, workers: 5, failure: 30 }, seed: 5 },
    { id: 'settled', label: 'Partial failure, allSettled', description: 'Survivors merged, result flagged partial.', kind: 'failure', config: { tasks: 5, workers: 5, failure: 30, aggregation: 'settled' }, seed: 5 },
  ],
  phases: [{ label: 'Split', nodes: ['task'] }, { label: 'Parallel work', nodes: Array.from({ length: 10 }, (_, i) => `w${i}`) }, { label: 'Merge', nodes: ['agg'] }, { label: 'Result', nodes: ['done'] }],
  comparePresets: [
    { id: 'seq-par', label: 'Sequential vs parallel', description: 'Eight independent tasks of 1000 ms: one worker vs four.', a: { label: 'Sequential — 1 worker', config: { tasks: 8, workers: 1, latency: 1000, variance: 0 } }, b: { label: 'Parallel — 4 workers', config: { tasks: 8, workers: 4, latency: 1000, variance: 0 } } },
    { id: 'agg', label: 'Promise.all vs allSettled', description: 'Same failing worker, two aggregation strategies.', a: { label: 'Promise.all (impl)', config: { tasks: 5, workers: 5, failure: 30 } }, b: { label: 'allSettled + partial', config: { tasks: 5, workers: 5, failure: 30, aggregation: 'settled' } }, seed: 5 },
  ],
  state: [{ key: 'queued', label: 'Subtasks dispatched' }],
};
