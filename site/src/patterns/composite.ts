import { Recorder } from '../engine/recorder';
import type { PatternSim } from '../engine/types';

// Homepage: how validator-first, tool-grounded-review, loop-with-guard, human-gate and the
// label-driven-state-machine compose in autonomous-dev-loop (root README diagram). Scenarios, no randomness.

function simulate(c: Record<string, unknown>) {
  const s = String(c.scenario);
  const r = new Recorder();
  let labels: string[] = [];
  const label = (add: string[], remove: string[] = []) => {
    labels = [...labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !labels.includes(l))];
    r.set('labels', [...labels]);
  };
  r.set('labels', []).node('issue', 'ok').log('Issue opened', 'muted', 'issue').transit('issue-validator');
  r.run('validator', 900).count('llm');
  if (s === 'refine') {
    r.node('validator', 'blocked', 'NEEDS_REFINEMENT').log('validator-first: under-specified — no code is generated', 'warn', 'validator');
    label(['needs-refinement|warn']);
    r.transit('validator-refine', 500, { tone: 'warn' }).node('refine', 'blocked');
    return r.end('Stopped at the gate: needs-refinement', 'warn');
  }
  r.node('validator', 'ok', 'VALID').log('validator-first: VALID → label ready-for-dev', 'ok', 'validator');
  label(['ready-for-dev|accent']);
  r.transit('validator-gen', 600, { label: 'ready-for-dev' });
  label([], ['ready-for-dev|accent']);
  r.run('gen', 1400).count('llm').log('Code generation opens a PR', 'info', 'gen');
  label(['needs-review|accent']);
  r.transit('gen-review', 600, { label: 'needs-review' });
  const failures = s === 'happy' ? 0 : s === 'fix' ? 1 : 4;
  for (let i = 1; ; i++) {
    r.node('review', 'active', i > 1 ? `review ${i}` : null).log(i === 1 ? 'tool-grounded-review: checks run, evidence goes to the reviewer' : `Re-review after auto-fix attempt ${i - 1}`, 'info', 'review');
    r.wait(1200).count('llm');
    label([], ['needs-review|accent', 'changes-requested|warn']);
    if (i > failures) {
      r.node('review', 'ok', 'APPROVE').log('All checks PASS, verdict APPROVED → review-approved', 'ok', 'review');
      label(['review-approved|ok']);
      r.transit('review-human', 700, { tone: 'ok', label: 'review-approved' }).node('human', 'waiting', 'merge?');
      r.log('human-gate: a person merges — nothing in the loop can', 'violet', 'human');
      return r.end(i === 1 ? 'Approved — waiting for a human merge' : `Approved after ${i - 1} fix ${i - 1 === 1 ? 'attempt' : 'attempts'} — waiting for a human merge`, 'violet');
    }
    r.node('review', 'blocked', 'test: FAIL').log('A failing test forces REQUEST_CHANGES, whatever the model thinks', 'fail', 'review');
    label(['changes-requested|warn']);
    if (i > 3) {
      r.node('fix', 'fail', '3/3').log('loop-with-guard: 3 attempts exhausted → escalate', 'fail', 'fix');
      label(['needs-human|violet']);
      r.transit('fix-human', 700, { tone: 'fail' }).node('human', 'waiting', 'escalated');
      return r.end('Escalated to a human after 3 attempts', 'violet');
    }
    r.transit('review-fix', 600, { tone: 'warn', label: 'changes-requested' });
    label([`auto-fix-attempt-${i}|muted`]);
    r.run('fix', 1100, 'ok', `${i}/3`).count('llm').log(`loop-with-guard: auto-fix attempt ${i}/3 pushes a commit`, 'warn', 'fix');
    label(['needs-review|accent']);
    r.transit('fix-review', 600, { tone: 'warn' });
  }
}

export const composite: PatternSim = {
  slug: 'composite',
  invariant: 'Each gate is code or a person: the loop never merges.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1,
  params: [
    { key: 'scenario', label: 'Scenario', type: 'select', default: 'fix', options: [
      { value: 'happy', label: 'Approved first time' },
      { value: 'fix', label: 'Red test → auto-fix' },
      { value: 'exhausted', label: 'Fix attempts exhausted' },
      { value: 'refine', label: 'Under-specified issue' },
    ] },
  ],
  graph: () => ({
    nodes: [
      { id: 'issue', label: 'Issue', kind: 'start', rank: 0, lane: 0 },
      { id: 'validator', label: 'validator-first', sub: 'low effort', kind: 'gate', rank: 1, lane: 0 },
      { id: 'refine', label: 'needs-refinement', kind: 'fail', rank: 1, lane: 1 },
      { id: 'gen', label: 'Code generation', sub: 'opens a PR', kind: 'agent', rank: 2, lane: 0 },
      { id: 'review', label: 'tool-grounded', sub: 'review', kind: 'gate', rank: 3, lane: 0 },
      { id: 'fix', label: 'loop-with-guard', sub: 'auto-fix ≤ 3', kind: 'agent', rank: 3, lane: 1 },
      { id: 'human', label: 'human-gate', sub: 'a person merges', kind: 'human', rank: 4, lane: 0.5 },
    ],
    edges: [
      { id: 'issue-validator', from: 'issue', to: 'validator' },
      { id: 'validator-refine', from: 'validator', to: 'refine' },
      { id: 'validator-gen', from: 'validator', to: 'gen' },
      { id: 'gen-review', from: 'gen', to: 'review' },
      { id: 'review-fix', from: 'review', to: 'fix', shift: -16 },
      { id: 'fix-review', from: 'fix', to: 'review', shift: 16 },
      { id: 'review-human', from: 'review', to: 'human' },
      { id: 'fix-human', from: 'fix', to: 'human' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [],
  derive: () => ({}),
  explain: () => [],
  presets: [],
  comparePresets: [],
  state: [{ key: 'labels', label: 'PR labels (the pipeline state)', empty: 'none yet' }],
};
