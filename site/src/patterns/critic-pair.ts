import { Recorder } from '../engine/recorder';
import { chance } from '../engine/rng';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const N = n(c, 'proposals');
  const challenger = c.challenger !== false;
  for (let i = 0; i < N; i++) {
    const flawed = chance(n(c, 'flawRate') / 100, seed, 'flaw', i);
    for (const id of ['proposer', 'challenger', 'judge', 'done', 'escalate']) r.node(id, 'idle', null);
    r.node('input', 'active', `#${i + 1}`).transit('input-proposer', 250);
    r.run('proposer', 900, 'ok', flawed ? 'has a flaw' : 'correct').count('calls');
    r.log(`Proposal #${i + 1}: ${flawed ? 'contains a real flaw (unhandled edge case)' : 'correct'}`, 'muted', 'proposer');
    let critique: 'found' | 'missed' | 'hallucinated' | 'clean';
    if (challenger) {
      r.transit('proposer-challenger', 300).run('challenger', 1100).count('calls');
      if (flawed) critique = chance(n(c, 'detect') / 100, seed, 'detect', i) ? 'found' : 'missed';
      else critique = chance(n(c, 'hallucinate') / 100, seed, 'hall', i) ? 'hallucinated' : 'clean';
      r.log(critique === 'found' ? 'Challenger finds the flaw' : critique === 'missed' ? 'Challenger misses it' : critique === 'hallucinated' ? 'Challenger invents a flaw that does not exist' : 'Challenger finds nothing real', critique === 'found' ? 'ok' : critique === 'clean' ? 'muted' : 'warn', 'challenger');
      r.transit('challenger-judge', 300, { label: 'critique' });
    } else {
      r.node('challenger', 'skipped', null).transit('proposer-judge', 300);
      critique = flawed ? (chance(n(c, 'alone') / 100, seed, 'alone', i) ? 'found' : 'missed') : 'clean';
    }
    r.run('judge', 800).count('calls');
    const accept = c.judge === 'sycophantic' ? true : critique === 'found' || critique === 'hallucinated' ? false : true;
    if (accept) {
      r.node('judge', 'ok', 'ACCEPTED').transit('judge-done', 300, { tone: flawed ? 'fail' : 'ok' }).node('done', flawed ? 'fail' : 'ok', `#${i + 1}`);
      r.count(flawed ? 'shipped' : 'accepted');
      r.log(flawed ? `ACCEPTED — the flaw ships${c.judge === 'sycophantic' && critique === 'found' ? ' (the judge ignored the critique)' : ''}` : 'ACCEPTED', flawed ? 'fail' : 'ok', 'judge');
    } else {
      r.node('judge', 'blocked', 'REJECTED').transit('judge-escalate', 300, { tone: 'warn' }).node('escalate', 'blocked', `#${i + 1}`);
      r.count(flawed ? 'caught' : 'falseReject');
      r.log(flawed ? 'REJECTED with a structured critique' : 'REJECTED a correct proposal on a hallucinated critique', flawed ? 'ok' : 'fail', 'judge');
    }
  }
  r.node('input', 'ok', null);
  return r.end(`${N} proposals judged`, 'ok');
}

export const criticPair: PatternSim = {
  slug: 'critic-pair',
  invariant: 'A challenger actively tries to break the proposal before a judge decides — three calls, adversarial by design.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 2.5,
  params: [
    { key: 'proposals', label: 'Proposals', type: 'number', min: 1, max: 12, step: 1, default: 6 },
    { key: 'flawRate', label: 'Proposals with a real flaw', type: 'number', min: 0, max: 100, step: 5, default: 50, unit: '%' },
    { key: 'challenger', label: 'Challenger agent', type: 'toggle', default: true, help: 'Off = a single-pass judge (baseline).' },
    { key: 'detect', label: 'Challenger finds a real flaw', type: 'number', min: 0, max: 100, step: 5, default: 80, unit: '%', visibleIf: (c) => c.challenger !== false },
    { key: 'hallucinate', label: 'Challenger invents a flaw', type: 'number', min: 0, max: 100, step: 5, default: 15, unit: '%', visibleIf: (c) => c.challenger !== false },
    { key: 'alone', label: 'Single-pass judge finds a flaw', type: 'number', min: 0, max: 100, step: 5, default: 40, unit: '%', visibleIf: (c) => c.challenger === false },
    { key: 'judge', label: 'Judge', type: 'select', default: 'balanced', options: [{ value: 'balanced', label: 'Weighs the critique' }, { value: 'sycophantic', label: 'Sycophantic (always accepts)' }] },
  ],
  graph: () => ({
    nodes: [
      { id: 'input', label: 'Task input', kind: 'start', rank: 0, lane: 0 },
      { id: 'proposer', label: 'Proposer', sub: 'agent', kind: 'agent', rank: 1, lane: 0 },
      { id: 'challenger', label: 'Challenger', sub: 'adversarial', kind: 'agent', rank: 2, lane: 0 },
      { id: 'judge', label: 'Judge', sub: 'ACCEPTED?', kind: 'gate', rank: 3, lane: 0 },
      { id: 'done', label: 'Return proposal', kind: 'end', rank: 4, lane: 0 },
      { id: 'escalate', label: 'Escalate', sub: 'with critique', kind: 'human', rank: 4, lane: 1 },
    ],
    edges: [
      { id: 'input-proposer', from: 'input', to: 'proposer' },
      { id: 'proposer-challenger', from: 'proposer', to: 'challenger' },
      { id: 'challenger-judge', from: 'challenger', to: 'judge' },
      { id: 'proposer-judge', from: 'proposer', to: 'judge', side: 'far', dashed: true, label: 'no challenger' },
      { id: 'judge-done', from: 'judge', to: 'done', label: 'yes' },
      { id: 'judge-escalate', from: 'judge', to: 'escalate', label: 'no' },
    ],
  }),
  simulate,
  metrics: [
    { key: 'caught', label: 'Flaws caught', format: 'int', better: 'higher' },
    { key: 'shipped', label: 'Flaws shipped', format: 'int', better: 'lower' },
    { key: 'falseReject', label: 'Correct proposals rejected', format: 'int', better: 'lower' },
    { key: 'accepted', label: 'Correct proposals accepted', format: 'int' },
    { key: 'calls', label: 'Agent calls', format: 'int', better: 'lower' },
    { key: 'duration', label: 'Simulated duration', format: 'ms', better: 'lower' },
  ],
  derive: (t: Trace) => ({ caught: t.counters.caught ?? 0, shipped: t.counters.shipped ?? 0, falseReject: t.counters.falseReject ?? 0, accepted: t.counters.accepted ?? 0, calls: t.counters.calls ?? 0, duration: t.duration }),
  explain: (t, c) => {
    const out: string[] = [];
    if (c.challenger !== false) out.push(`The challenger caught ${t.counters.caught ?? 0} flaw(s) at the price of a third call per proposal (${t.counters.calls} calls).`);
    else out.push(`A single-pass judge caught ${t.counters.caught ?? 0} flaw(s) and let ${t.counters.shipped ?? 0} through, with two calls per proposal.`);
    if (t.counters.falseReject) out.push(`${t.counters.falseReject} correct proposal(s) were rejected on invented critique — the cost of an adversarial reviewer that hallucinates.`);
    if (c.judge === 'sycophantic') out.push('A sycophantic judge accepts everything: the critique was produced, paid for and ignored.');
    return out;
  },
  compare: (a, b) => metricDeltas(criticPair.metrics, a, b),
  presets: [
    { id: 'default', label: 'Balanced judge', description: 'Challenger 80 % recall, 15 % invention.', kind: 'scenario', config: {} },
    { id: 'hall', label: 'Hallucinated critique', description: 'The challenger invents flaws often.', kind: 'failure', config: { hallucinate: 60, flawRate: 20 } },
    { id: 'syco', label: 'Sycophantic judge', description: 'Always ACCEPTED.', kind: 'failure', config: { judge: 'sycophantic' } },
  ],
  comparePresets: [
    { id: 'single', label: 'Single pass vs critic pair', description: 'Same proposals: one judge vs challenger + judge.', a: { label: 'Single-pass judge', config: { challenger: false, proposals: 10 } }, b: { label: 'Challenger + judge', config: { proposals: 10 } } },
  ],
};
