import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);

function simulate(c: Config) {
  const r = new Recorder();
  r.set('action', 'not executed').node('task', 'ok').log('Task: "Write a SQL migration that adds last_login to users"', 'muted', 'task').transit('task-pipeline', 300);
  r.node('pipeline', 'active').wait(2000).count('calls');
  if (c.refusal) {
    r.node('pipeline', 'fail', 'refused').log('stop_reason "refusal": nothing to review — halt, report, no action', 'fail', 'pipeline');
    r.transit('pipeline-halt', 400, { tone: 'fail', t: undefined }).node('halt', 'blocked');
    return r.end('HALTED — refusal, no action taken', 'warn');
  }
  r.node('pipeline', 'ok').log('Candidate migration ready', 'ok', 'pipeline').transit('pipeline-present', 300);
  r.run('present', 300).transit('present-gate', 300);
  r.node('gate', 'waiting', 'yes / no?').log('The system stops and waits — it does not proceed on timeout', 'violet', 'gate');
  const answer = String(c.answer);
  const wait = n(c, 'responseS') * 1000;
  const timeout = n(c, 'timeoutS') * 1000;
  if (answer === 'none' || wait > timeout) {
    r.wait(timeout).log(`No answer after ${n(c, 'timeoutS')} s`, 'warn', 'gate');
    if (c.autoProceed) {
      r.node('gate', 'fail', 'timeout → proceed').log('Anti-pattern: the gate proceeds on timeout — an irreversible action without a human', 'fail', 'gate');
      r.transit('gate-action', 400, { tone: 'fail' }).node('action', 'fail', 'merged').set('action', 'EXECUTED without approval|fail');
      return r.end('MERGED without approval', 'fail');
    }
    r.node('gate', 'blocked', 'timeout').transit('gate-halt', 400, { tone: 'warn' }).node('halt', 'blocked');
    return r.end('HALTED — no answer, nothing committed', 'warn');
  }
  r.wait(wait);
  if (answer === 'yes') {
    r.node('gate', 'ok', 'yes').log('Human answers yes', 'ok', 'gate').transit('gate-action', 400, { tone: 'ok' });
    r.run('action', 900, 'ok', 'merged').count('calls').set('action', 'executed after approval|ok').log('Irreversible action: merge', 'ok', 'action');
    r.transit('action-done', 300).node('done', 'ok');
    return r.end('MERGED — explicitly approved', 'ok');
  }
  r.node('gate', 'blocked', 'no').log('Human answers no', 'warn', 'gate').transit('gate-halt', 400, { tone: 'warn' }).node('halt', 'blocked');
  return r.end('HALTED — rejected, no action taken', 'warn');
}

export const humanGate: PatternSim = {
  slug: 'human-gate',
  invariant: 'The irreversible action runs only on an explicit yes — no, silence and timeouts all halt.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 3,
  params: [
    { key: 'answer', label: 'Human answer', type: 'select', default: 'yes', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }, { value: 'none', label: 'No answer' }] },
    { key: 'responseS', label: 'Human response time', type: 'number', min: 1, max: 60, step: 1, default: 8, unit: 's', visibleIf: (c) => c.answer !== 'none' },
    { key: 'timeoutS', label: 'Wait limit', type: 'number', min: 5, max: 60, step: 5, default: 30, unit: 's' },
    { key: 'autoProceed', label: 'Proceed on timeout (anti-pattern)', type: 'toggle', default: false, help: 'The failure mode the impl explicitly does not have.' },
    { key: 'refusal', label: 'Pipeline call refused', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'task', label: 'Task input', kind: 'start', rank: 0, lane: 0 },
      { id: 'pipeline', label: 'Autonomous pipeline', kind: 'agent', rank: 1, lane: 0 },
      { id: 'present', label: 'Present output', kind: 'agent', rank: 2, lane: 0 },
      { id: 'gate', label: 'Human approves?', kind: 'human', rank: 3, lane: 0 },
      { id: 'action', label: 'Irreversible action', sub: 'merge / deploy', kind: 'effect', rank: 4, lane: 0 },
      { id: 'done', label: 'Done', kind: 'end', rank: 5, lane: 0 },
      { id: 'halt', label: 'Halt — no action', kind: 'fail', rank: 4, lane: 1 },
    ],
    edges: [
      { id: 'task-pipeline', from: 'task', to: 'pipeline' },
      { id: 'pipeline-present', from: 'pipeline', to: 'present' },
      { id: 'present-gate', from: 'present', to: 'gate' },
      { id: 'gate-action', from: 'gate', to: 'action', label: 'yes' },
      { id: 'action-done', from: 'action', to: 'done' },
      { id: 'gate-halt', from: 'gate', to: 'halt', label: 'no / timeout' },
      { id: 'pipeline-halt', from: 'pipeline', to: 'halt', side: 'near', dashed: true, label: 'refusal' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'action', label: 'Irreversible action', format: 'text' },
    { key: 'duration', label: 'Simulated time to outcome', format: 'ms', hint: 'Human latency is part of the cost of the gate.' },
  ],
  derive: (t: Trace) => ({ outcome: t.outcome?.label ?? '—', action: String(t.vars.action ?? '—').split('|')[0], duration: t.duration }),
  explain: (t, c) => {
    const label = t.outcome?.label ?? '';
    if (label.startsWith('MERGED without')) return ['A gate that proceeds on timeout is not a gate: the merge happened with nobody having read it.'];
    if (label.startsWith('MERGED')) return [`The action ran only after an explicit yes, ${n(c, 'responseS')} s into the wait: human latency is the price of the guarantee.`];
    return ['Nothing was committed. On no, silence or refusal the pipeline halts — absence of a yes is never consent.'];
  },
  compare: (a, b) => [`A: ${a.metrics.outcome}. B: ${b.metrics.outcome}.`],
  presets: [
    { id: 'default', label: 'Approved', description: 'An explicit yes.', kind: 'scenario', config: {} },
    { id: 'no', label: 'Rejected', description: 'An explicit no.', kind: 'scenario', config: { answer: 'no' } },
    { id: 'silence', label: 'No answer', description: 'Timeout halts.', kind: 'failure', config: { answer: 'none' } },
    { id: 'auto', label: 'Timeout auto-proceed', description: 'The anti-pattern.', kind: 'failure', config: { answer: 'none', autoProceed: true } },
    { id: 'refusal', label: 'Refusal', description: 'Ends at the gate the same way.', kind: 'failure', config: { refusal: true } },
  ],
  phases: [{ label: 'Pipeline', nodes: ['task', 'pipeline', 'present'] }, { label: 'Wait for a human', nodes: ['gate'] }, { label: 'Outcome', nodes: ['action', 'done', 'halt'] }],
  comparePresets: [
    { id: 'timeout', label: 'Halt vs proceed on timeout', description: 'Nobody answers.', a: { label: 'Proceed on timeout (anti-pattern)', config: { answer: 'none', autoProceed: true } }, b: { label: 'Halt (impl)', config: { answer: 'none' } }, caveat: 'Scenario A is the failure mode, not the documented implementation.' },
  ],
  state: [{ key: 'action', label: 'Irreversible action' }],
};
