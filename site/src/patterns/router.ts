import { Recorder } from '../engine/recorder';
import { chance, jitter, rand } from '../engine/rng';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const CATS = ['BUG_FIX', 'FEATURE', 'REFACTOR', 'SECURITY'] as const;
const n = (c: Config, k: string) => Number(c[k]);
const ROUTER_UNITS = 300; // low effort, one word out
const SPECIALIST_UNITS = 3000;

/** The true category of task i: a fixed one, or a deterministic mix that includes off-taxonomy tasks. */
function truthOf(c: Config, seed: number, i: number): string {
  if (c.category !== 'MIXED') return String(c.category);
  const u = rand(seed, 'cat', i);
  return u < 0.85 ? CATS[Math.floor((u / 0.85) * 4)] : 'DOCS';
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const tasks = n(c, 'tasks');
  const lat = n(c, 'latency');
  r.node('input', 'ok', `${tasks} tasks`);
  for (let i = 0; i < tasks; i++) {
    const truth = truthOf(c, seed, i);
    for (const id of ['router', ...CATS, ...(c.unknown === 'generalist' ? ['GENERALIST'] : [])]) r.node(id, 'idle', null);
    r.log(`Task #${i + 1} (actually ${truth === 'DOCS' ? 'a docs request — no category fits' : truth})`, 'muted', 'input');
    r.transit('input-router', 300, { label: `#${i + 1}` });
    r.run('router', 250, 'ok').count('routerCalls').count('tokens', ROUTER_UNITS);
    let label: string;
    if (truth === 'DOCS') label = 'DOCS';
    else if (chance(n(c, 'accuracy') / 100, seed, 'route', i)) label = truth;
    else { const others = CATS.filter((x) => x !== truth); label = others[Math.floor(rand(seed, 'wrong', i) * others.length)]; }
    let target = label;
    if (!CATS.includes(label as (typeof CATS)[number])) {
      target = c.unknown === 'generalist' ? 'GENERALIST' : 'FEATURE';
      r.node('router', 'warn', `"${label}"`).log(`Router answered "${label}" — not a known category → ${c.unknown === 'generalist' ? 'fallback generalist' : 'defaults to FEATURE (impl)'}`, 'warn', 'router');
      r.count(c.unknown === 'generalist' ? 'fallback' : 'defaulted');
    } else r.log(`Router: ${label}`, label === truth ? 'info' : 'warn', 'router');
    r.transit(`router-${target}`, 350, { tone: target === truth ? 'accent' : truth === 'DOCS' && target === 'GENERALIST' ? 'violet' : 'warn' });
    r.node(target, 'active', `#${i + 1}`).wait(jitter(lat, 0.2, seed, 'spec', i)).count('tokens', SPECIALIST_UNITS);
    const correct = target === truth;
    const generalistOk = target === 'GENERALIST';
    if (correct) { r.node(target, 'ok').count('onTarget').log(`${target} specialist: focused, on-target result`, 'ok', target); }
    else if (generalistOk) { r.node(target, 'ok').count('generalist').log('Generalist handles the off-taxonomy task: broad, less focused, but not out of domain', 'violet', target); }
    else { r.node(target, 'blocked').count('misrouted').log(`${target} specialist on a ${truth} task: a confident but irrelevant result`, 'fail', target); }
    r.transit(`${target}-done`, 300, { tone: correct ? 'ok' : generalistOk ? 'violet' : 'fail' });
  }
  r.node('done', 'ok');
  return r.end(`${tasks} tasks routed`, 'ok');
}

export const router: PatternSim = {
  slug: 'router',
  invariant: 'The routing decision is made once, upfront: a wrong label silently sends the task to the wrong specialist.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 2,
  params: [
    { key: 'category', label: 'Task category', type: 'select', default: 'MIXED', options: [
      { value: 'MIXED', label: 'Mixed stream (incl. off-taxonomy)' },
      ...CATS.map((x) => ({ value: x, label: x })),
      { value: 'DOCS', label: 'DOCS (no category fits)' },
    ] },
    { key: 'tasks', label: 'Tasks routed', type: 'number', min: 1, max: 12, step: 1, default: 6 },
    { key: 'accuracy', label: 'Routing accuracy (simulated)', type: 'number', min: 0, max: 100, step: 5, default: 85, unit: '%' },
    { key: 'latency', label: 'Specialist latency', type: 'number', min: 200, max: 3000, step: 100, default: 900, unit: 'ms' },
    { key: 'unknown', label: 'Unknown-category handling', type: 'select', default: 'feature', options: [
      { value: 'feature', label: 'Default to FEATURE (impl)', note: 'SPECIALISTS[normalized] ?? SPECIALISTS.FEATURE' },
      { value: 'generalist', label: 'Fallback generalist', note: 'the README alternative for tasks no category covers' },
    ] },
  ],
  graph: (c) => ({
    nodes: [
      { id: 'input', label: 'Task input', kind: 'start', rank: 0, lane: 2 },
      { id: 'router', label: 'Router', sub: 'effort: low', kind: 'gate', rank: 1, lane: 2 },
      ...CATS.map((x, i) => ({ id: x, label: x, sub: 'effort: medium', kind: 'agent' as const, rank: 2, lane: i + (c.unknown === 'generalist' ? 0 : 0.5) })),
      ...(c.unknown === 'generalist' ? [{ id: 'GENERALIST', label: 'Generalist', sub: 'fallback', kind: 'agent' as const, rank: 2, lane: 4 }] : []),
      { id: 'done', label: 'Result', kind: 'end', rank: 3, lane: 2 },
    ],
    edges: [
      { id: 'input-router', from: 'input', to: 'router' },
      ...CATS.map((x) => ({ id: `router-${x}`, from: 'router', to: x })),
      ...CATS.map((x) => ({ id: `${x}-done`, from: x, to: 'done' })),
      ...(c.unknown === 'generalist' ? [{ id: 'router-GENERALIST', from: 'router', to: 'GENERALIST', label: 'unknown' }, { id: 'GENERALIST-done', from: 'GENERALIST', to: 'done' }] : []),
    ],
  }),
  simulate,
  metrics: [
    { key: 'onTarget', label: 'Routed to the right specialist', format: 'int', better: 'higher' },
    { key: 'misrouted', label: 'Misrouted (confident, irrelevant)', format: 'int', better: 'lower' },
    { key: 'defaulted', label: 'Unknown → FEATURE', format: 'int', better: 'lower' },
    { key: 'generalist', label: 'Unknown → generalist', format: 'int' },
    { key: 'routerShare', label: 'Router share of tokens', format: 'pct', hint: 'README: routing cost stays small next to the specialist call.' },
    { key: 'duration', label: 'Simulated duration', format: 'ms' },
  ],
  derive: (t: Trace) => {
    const router = (t.counters.routerCalls ?? 0) * ROUTER_UNITS;
    return {
      onTarget: t.counters.onTarget ?? 0,
      misrouted: t.counters.misrouted ?? 0,
      defaulted: t.counters.defaulted ?? 0,
      generalist: t.counters.generalist ?? 0,
      routerShare: t.counters.tokens ? (router / t.counters.tokens) * 100 : 0,
      duration: t.duration,
    };
  },
  explain: (t, c) => {
    const out: string[] = [];
    const m = t.counters.misrouted ?? 0, d = t.counters.defaulted ?? 0;
    if (m) out.push(`${m} task(s) went to the wrong specialist. Nothing downstream flags it: the result looks confident, it is just about something else.`);
    if (d) out.push(`${d} off-taxonomy task(s) got a label outside the set and fell through to FEATURE — the impl's default — so a docs request was implemented as a feature.`);
    if (c.unknown === 'generalist' && t.counters.generalist) out.push('The fallback generalist absorbed the tasks no category fits instead of forcing them into one.');
    if (!m && !d) out.push('Every task reached a specialist whose prompt covers it.');
    out.push(`Routing ran at low effort: about ${Math.round(((t.counters.routerCalls ?? 0) * ROUTER_UNITS / (t.counters.tokens || 1)) * 100)} % of the simulated tokens.`);
    return out;
  },
  compare: (a, b) => metricDeltas(router.metrics, a, b),
  presets: [
    { id: 'default', label: 'Mixed stream', description: 'Six tasks, one off-taxonomy.', kind: 'scenario', config: {} },
    { id: 'perfect', label: 'Perfect router', description: 'Accuracy 100 %, known categories only.', kind: 'scenario', config: { category: 'BUG_FIX', accuracy: 100 } },
    { id: 'misroute', label: 'Misclassification', description: 'A router right 50 % of the time.', kind: 'failure', config: { accuracy: 50 }, seed: 3 },
    { id: 'unknown', label: 'Unknown category', description: 'Every task is a docs request.', kind: 'failure', config: { category: 'DOCS', tasks: 3 } },
  ],
  comparePresets: [
    { id: 'fallback', label: 'Default FEATURE vs generalist', description: 'Same stream, two ways to handle a task no category fits.', a: { label: 'Default to FEATURE (impl)', config: { category: 'MIXED', tasks: 10 } }, b: { label: 'Fallback generalist', config: { category: 'MIXED', tasks: 10, unknown: 'generalist' } }, seed: 9 },
    { id: 'accuracy', label: 'Accuracy 95 % vs 70 %', description: 'Misrouting is silent: compare how many tasks land on the wrong specialist.', a: { label: '95 %', config: { accuracy: 95, tasks: 12 } }, b: { label: '70 %', config: { accuracy: 70, tasks: 12 } } },
  ],
};
