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
  // Tiles in one row (the mockup's hero); `compact` = icon-only for phones.
  graph: (c) => {
    const size = c.compact ? 'icon' as const : 'tile' as const;
    const t = (id: string, label: string, icon: string, rank: number, tone: 'accent' | 'ok' | 'violet' | 'muted', kind: 'start' | 'gate' | 'agent' | 'human' | 'fail' = 'agent', lane = 0) =>
      ({ id, label, icon, rank, lane, tone, kind, size });
    return {
      nodes: [
        t('issue', 'Issue', 'file', 0, 'accent', 'start'),
        t('validator', 'validator-\nfirst', 'shield', 1, 'ok', 'gate'),
        t('gen', 'code\ngeneration', 'code', 2, 'muted'),
        t('review', 'tool-\ngrounded-\nreview', 'search', 3, 'accent', 'gate'),
        t('fix', 'loop-\nwith-guard', 'loop', 4, 'violet'),
        t('human', 'human-\ngate', 'person', 5, 'ok', 'human'),
        t('refine', 'needs-\nrefinement', 'close', 1, 'muted', 'fail', 1.35),
      ],
      edges: [
        { id: 'issue-validator', from: 'issue', to: 'validator' },
        { id: 'validator-refine', from: 'validator', to: 'refine' },
        { id: 'validator-gen', from: 'validator', to: 'gen' },
        { id: 'gen-review', from: 'gen', to: 'review' },
        { id: 'review-fix', from: 'review', to: 'fix' },
        { id: 'fix-review', from: 'fix', to: 'review', side: 'far', dashed: true, depth: c.compact ? -10 : 0 },
        { id: 'review-human', from: 'review', to: 'human', side: 'near', dashed: true, depth: c.compact ? -10 : 0 },
        { id: 'fix-human', from: 'fix', to: 'human' },
      ],
      rankGap: c.compact ? 52 : 112,
    };
  },
  simulate: (c) => simulate(c),
  metrics: [],
  derive: () => ({}),
  explain: () => [],
  presets: [],
  comparePresets: [],
  state: [{ key: 'labels', label: 'PR labels (the pipeline state)', empty: 'none yet' }],
};
