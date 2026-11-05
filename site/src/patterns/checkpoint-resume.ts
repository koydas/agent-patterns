import { Recorder } from '../engine/recorder';
import { jitter } from '../engine/rng';
import { metricDeltas, plural } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const NAMES = ['analyze', 'plan', 'implement', 'test', 'review', 'package'];
const n = (c: Config, k: string) => Number(c[k]);
const RESTART_MS = 900;

function simulate(c: Config, seed: number) {
  const stages = n(c, 'stages');
  const fail = c.failAt === 'none' ? 0 : Math.min(Number(c.failAt), stages);
  const resume = c.recovery === 'resume';
  const write = n(c, 'writeMs');
  const lat = (i: number) => jitter(n(c, 'latency'), 0.2, seed, 'stage', i);
  const r = new Recorder();
  let saved = 0; // checkpoint: number of completed steps
  let checkpointOk = true;
  const runStage = (i: number, attempt: number) => {
    r.node(`s${i}`, 'active', attempt > 1 ? 'again' : null).log(`Step ${i + 1}/${stages}: ${NAMES[i]}${attempt > 1 ? ' — runs again' : ''}`, attempt > 1 ? 'warn' : 'info', `s${i}`);
    r.wait(lat(i)).count('llmCalls').count('stageRuns');
    if (attempt > 1) r.count('repeated');
  };
  const save = (i: number, crash: boolean) => {
    if (!resume) return;
    r.transit(`s${i}-cp${i}`, 200).node(`cp${i}`, 'active');
    if (crash && c.atomic === false) {
      r.wait(write / 2).node(`cp${i}`, 'fail', 'torn').log('Crash mid-write: the checkpoint file is half written (non-atomic write)', 'fail', `cp${i}`);
      checkpointOk = false;
      return;
    }
    r.wait(write).node(`cp${i}`, 'ok', `step ${i + 1}`).log(`Checkpoint ${i + 1} saved (${c.atomic === false ? 'direct write' : 'tmp + rename'})`, 'muted', `cp${i}`);
    saved = i + 1;
    r.set('checkpoint', `after step ${saved}`);
  };

  r.set('checkpoint', 'none').set('process', 'run 1');
  r.node('start', 'ok').transit('start-load', 250).run('load', 150, 'ok', 'none').log('No checkpoint: start from step 1', 'muted', 'load');
  r.transit('load-s0', 250);
  for (let i = 0; i < stages; i++) {
    const crashHere = fail === i + 1;
    runStage(i, 1);
    if (crashHere && c.crashWhen === 'during') {
      r.node(`s${i}`, 'fail', 'crash').log(`Process dies during step ${i + 1} (rate limit / runner timeout)`, 'fail', `s${i}`);
      break;
    }
    r.node(`s${i}`, 'ok');
    save(i, crashHere);
    if (crashHere) {
      if (c.atomic !== false || !resume) r.node(`s${i}`, 'fail', 'crash').log(`Process dies right after step ${i + 1}`, 'fail', `s${i}`);
      break;
    }
    if (i < stages - 1) r.transit(`s${i}-s${i + 1}`, 200);
  }
  if (!fail) {
    r.transit(`s${stages - 1}-done`, 250).node('done', 'ok').log('Done — checkpoint cleared', 'ok', 'done');
    return r.end(`Completed ${stages} steps in one run`, 'ok');
  }

  // second process
  r.wait(RESTART_MS).set('process', 'run 2 (after restart)');
  for (let i = 0; i < stages; i++) r.node(`s${i}`, 'idle', null);
  r.log('Process restarts', 'violet', 'start');
  r.node('start', 'active').transit('start-load', 250);
  let from = 0;
  if (!resume) {
    r.run('load', 150, 'ok', 'none').log('No checkpoint mechanism: everything starts again from step 1', 'warn', 'load');
  } else if (!checkpointOk) {
    r.run('load', 150, 'fail', 'corrupt').log('Checkpoint unreadable (JSON.parse fails on the torn file) — restart from step 1', 'fail', 'load');
    r.count('corrupt');
  } else {
    from = saved;
    r.run('load', 150, 'ok', saved ? `step ${saved}` : 'none').log(saved ? `Checkpoint found: skip steps 1–${saved}, resume at step ${saved + 1}` : 'Checkpoint empty: start at step 1', 'ok', 'load');
    for (let i = 0; i < saved; i++) r.node(`s${i}`, 'skipped', 'from checkpoint').count('skipped');
    if (c.stale && saved) {
      r.log('The task input changed between runs, but the checkpoint was not cleared: resumed state is stale', 'warn', 'load');
      r.count('stale');
    }
  }
  r.node('start', 'ok');
  r.transit(`load-s${from}`, 250);
  for (let i = from; i < stages; i++) {
    runStage(i, i < fail ? 2 : 1);
    r.node(`s${i}`, 'ok');
    save(i, false);
    if (i < stages - 1) r.transit(`s${i}-s${i + 1}`, 200);
  }
  r.transit(`s${stages - 1}-done`, 250);
  if (c.stale && resume && from > 0) {
    r.node('done', 'warn').log('Completed — on an outdated plan', 'warn', 'done');
    return r.end('COMPLETED on stale state', 'warn');
  }
  r.node('done', 'ok').log('Done — checkpoint cleared', 'ok', 'done');
  return r.end(`Recovered — ${plural(r.events.filter((e) => e.type === 'count' && e.key === 'repeated').length, 'step')} repeated`, 'ok');
}

export const checkpointResume: PatternSim = {
  slug: 'checkpoint-resume',
  invariant: 'State is persisted after each step; a restarted process skips the steps already saved.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 2,
  params: [
    { key: 'stages', label: 'Pipeline steps', type: 'number', min: 2, max: 6, step: 1, default: 3, source: 'impl: analyze → plan → implement' },
    { key: 'failAt', label: 'Process dies at step', type: 'select', default: '3', options: [{ value: 'none', label: 'No failure' }, ...[1, 2, 3, 4, 5, 6].map((i) => ({ value: String(i), label: `Step ${i}` }))] },
    { key: 'crashWhen', label: 'Crash timing', type: 'select', default: 'during', options: [
      { value: 'during', label: 'During the step' },
      { value: 'after', label: 'While saving' },
    ] },
    { key: 'recovery', label: 'Recovery', type: 'select', default: 'resume', options: [
      { value: 'resume', label: 'Resume from checkpoint', note: 'the pattern' },
      { value: 'restart', label: 'Restart from step 1', note: 'no persisted state' },
    ] },
    { key: 'latency', label: 'Step latency (LLM call)', type: 'number', min: 300, max: 3000, step: 100, default: 1500, unit: 'ms' },
    { key: 'writeMs', label: 'Checkpoint write cost', type: 'number', min: 20, max: 800, step: 20, default: 120, unit: 'ms', visibleIf: (c) => c.recovery === 'resume' },
    { key: 'atomic', label: 'Atomic write (tmp + rename)', type: 'toggle', default: true, source: 'impl: saveCheckpoint', visibleIf: (c) => c.recovery === 'resume' },
    { key: 'stale', label: 'Task input changed before the restart', type: 'toggle', default: false, visibleIf: (c) => c.recovery === 'resume' },
  ],
  graph: (c) => {
    const s = n(c, 'stages');
    const resume = c.recovery === 'resume';
    return {
      nodes: [
        { id: 'start', label: 'Start', kind: 'start', rank: 0, lane: 0 },
        { id: 'load', label: 'Checkpoint?', kind: 'gate', rank: 1, lane: 0 },
        ...Array.from({ length: s }, (_, i) => ({ id: `s${i}`, label: NAMES[i], sub: `step ${i + 1}`, kind: 'agent' as const, rank: 2 + i, lane: 0 })),
        ...(resume ? Array.from({ length: s }, (_, i) => ({ id: `cp${i}`, label: `cp ${i + 1}`, kind: 'store' as const, rank: 2 + i, lane: 1, size: 'sm' as const })) : []),
        { id: 'done', label: 'Result', kind: 'end', rank: 2 + s, lane: 0 },
      ],
      edges: [
        { id: 'start-load', from: 'start', to: 'load' },
        { id: 'load-s0', from: 'load', to: 's0' },
        ...Array.from({ length: s - 1 }, (_, i) => ({ id: `s${i}-s${i + 1}`, from: `s${i}`, to: `s${i + 1}` })),
        ...Array.from({ length: s - 1 }, (_, i) => ({ id: `load-s${i + 1}`, from: 'load', to: `s${i + 1}`, side: 'far' as const, depth: i * 8, dashed: true })),
        ...(resume ? Array.from({ length: s }, (_, i) => ({ id: `s${i}-cp${i}`, from: `s${i}`, to: `cp${i}` })) : []),
        { id: `s${s - 1}-done`, from: `s${s - 1}`, to: 'done' },
      ],
      rankGap: s > 4 ? 138 : undefined,
    };
  },
  simulate,
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'duration', label: 'Simulated total time', format: 'ms', better: 'lower' },
    { key: 'stageRuns', label: 'Step executions (LLM calls)', format: 'int', better: 'lower' },
    { key: 'repeated', label: 'Repeated steps', format: 'int', better: 'lower' },
    { key: 'saved', label: 'Time saved vs restarting', format: 'ms', better: 'higher', estimate: true, hint: 'Same seed, recovery = restart, run by the same simulator.' },
  ],
  derive: (t: Trace, c, seed) => {
    let saved: number = NaN;
    if (t.outcome && c.recovery === 'resume') {
      const counter = checkpointResume.simulate({ ...c, recovery: 'restart' }, seed);
      const end = counter.find((e) => e.type === 'end')!.t;
      saved = end - t.duration;
    }
    return { outcome: t.outcome?.label ?? '—', duration: t.duration, stageRuns: t.counters.stageRuns ?? 0, repeated: t.counters.repeated ?? 0, saved };
  },
  explain: (t, c) => {
    const out: string[] = [];
    const rep = t.counters.repeated ?? 0;
    if (c.failAt === 'none') return ['No failure: checkpoints only cost their write time here — the pay-off is on a crash.'];
    if (c.recovery === 'restart') out.push(`Without persisted state the restart re-ran ${plural(rep, 'completed step')} — paying again for LLM calls that had already succeeded.`);
    else if (t.counters.corrupt) out.push('The crash tore a non-atomic checkpoint write; the next process could not read it and restarted from scratch. Writing to a temp file then renaming makes the save all-or-nothing.');
    else out.push(`The checkpoint avoided repeating ${plural(t.counters.skipped ?? 0, 'completed step')}; ${rep ? 'only the interrupted step ran again' : 'nothing ran twice'}.`);
    if (t.counters.stale) out.push('The input changed but the checkpoint was kept: the run finished on outdated intermediate state — a stale checkpoint is worse than a restart.');
    return out;
  },
  compare: (a, b) => {
    const out: string[] = [];
    if (a.config.recovery !== b.config.recovery) {
      const [res, rst] = a.config.recovery === 'resume' ? [a, b] : [b, a];
      out.push(`Checkpoint recovery repeated ${res.metrics.repeated} step(s) where restarting repeated ${rst.metrics.repeated}, finishing ${((Number(rst.metrics.duration) - Number(res.metrics.duration)) / 1000).toFixed(1)} s sooner.`);
    }
    return [...out, ...metricDeltas(checkpointResume.metrics, a, b)];
  },
  presets: [
    { id: 'default', label: 'Crash at step 3 (impl steps)', description: 'analyze, plan saved; implement dies.', kind: 'scenario', config: {} },
    { id: 'long', label: 'Six steps, crash at 5', description: 'Where checkpoints pay off most.', kind: 'scenario', config: { stages: 6, failAt: '5' } },
    { id: 'torn', label: 'Partial write', description: 'Crash while saving, non-atomic write.', kind: 'failure', config: { stages: 4, failAt: '3', crashWhen: 'after', atomic: false } },
    { id: 'stale', label: 'Stale checkpoint', description: 'The input changed; the checkpoint was not cleared.', kind: 'failure', config: { stale: true } },
  ],
  phases: [{ label: 'Load', nodes: ['start', 'load'] }, { label: 'Run steps', nodes: NAMES.map((_, i) => `s${i}`) }, { label: 'Save', nodes: NAMES.map((_, i) => `cp${i}`) }, { label: 'Done', nodes: ['done'] }],
  comparePresets: [
    { id: 'resume', label: 'Restart vs resume', description: 'Five steps, the process dies during step 4.', a: { label: 'Restart from step 1', config: { stages: 5, failAt: '4', recovery: 'restart' } }, b: { label: 'Resume from checkpoint', config: { stages: 5, failAt: '4' } } },
    { id: 'atomic', label: 'Atomic vs direct write', description: 'Crash while saving step 3.', a: { label: 'Direct write', config: { stages: 4, failAt: '3', crashWhen: 'after', atomic: false } }, b: { label: 'tmp + rename (impl)', config: { stages: 4, failAt: '3', crashWhen: 'after' } } },
  ],
  state: [{ key: 'process', label: 'Process' }, { key: 'checkpoint', label: 'checkpoint.json' }],
};
