import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';

const TYPES = ['BUG', 'REFACTOR', 'FEATURE'] as const;
const BLOCK: Record<string, string> = { BUG: 'Reproduction block', REFACTOR: 'Non-regression evidence', FEATURE: 'AC coverage only' };

export function judge(c: Config) {
  const actual = String(c.actual);
  const routed = c.routing === 'correct' ? actual : String(c.routing);
  const ev = String(c.evidence);
  const rerun = c.rerun !== false;
  let status: 'DONE' | 'NEEDS_REVIEW' = 'DONE';
  let why = '';
  if (ev === 'missing' && routed !== 'FEATURE') { status = 'NEEDS_REVIEW'; why = `${BLOCK[routed]} missing — mandatory for ${routed}`; }
  else if (routed === 'BUG' && actual !== 'BUG') {
    if (rerun) { status = 'NEEDS_REVIEW'; why = 'Re-run: the reproduction test already passes on the original code — there is no defect to reproduce'; }
    else why = 'Reproduction for a non-existent defect accepted as written';
  } else if (routed === 'BUG' && ev === 'fabricated') {
    if (rerun) { status = 'NEEDS_REVIEW'; why = 'Re-run: the "reproduction" passes on the buggy code — it proves nothing'; }
    else why = 'Fabricated reproduction accepted as written';
  } else if (routed === 'REFACTOR' && ev === 'fabricated') {
    if (rerun) { status = 'NEEDS_REVIEW'; why = 'Re-run: the listed tests do not cover the changed code'; }
    else why = 'Non-regression claim accepted as written';
  }
  const wrong = status === 'DONE' && (ev === 'fabricated' || routed !== actual);
  return { routed, status, why, wrong };
}

function simulate(c: Config) {
  const r = new Recorder();
  const j = judge(c);
  r.node('task', 'ok').log(`Task: actually a ${c.actual}`, 'muted', 'task').transit('task-router', 300);
  r.run('router', 500, j.routed === c.actual ? 'ok' : 'warn', j.routed).count('calls').log(`Router: ${j.routed}${j.routed !== c.actual ? ' — misclassified' : ''}`, j.routed === c.actual ? 'info' : 'warn', 'router');
  r.transit(`router-${j.routed}`, 350);
  r.run(j.routed, 1500).count('calls').log(`${j.routed.toLowerCase()} builder: patch + AC + ${BLOCK[j.routed]}${c.evidence === 'fabricated' && j.routed !== 'FEATURE' ? ' (fabricated)' : c.evidence === 'missing' && j.routed !== 'FEATURE' ? ' — omitted' : ''}`, 'info', j.routed);
  r.transit(`${j.routed}-ev${j.routed}`, 300).node(`ev${j.routed}`, c.evidence === 'valid' || j.routed === 'FEATURE' ? 'ok' : 'warn', BLOCK[j.routed]);
  r.transit(`ev${j.routed}-reviewer`, 350);
  r.node('reviewer', 'active').log(c.rerun !== false && j.routed !== 'FEATURE' ? `Reviewer applies the ${j.routed} rules and re-executes the evidence` : `Reviewer applies the ${j.routed} rules to the evidence as written`, 'info', 'reviewer').wait(c.rerun !== false ? 2200 : 1000).count('calls');
  if (j.status === 'NEEDS_REVIEW') {
    r.node('reviewer', 'blocked', 'NEEDS_REVIEW').log(j.why, 'warn', 'reviewer').transit('reviewer-done', 300, { tone: 'warn' }).node('done', 'waiting', 'NEEDS_REVIEW');
    return r.end('NEEDS_REVIEW', 'violet');
  }
  r.node('reviewer', 'ok', 'DONE');
  if (j.why) r.log(j.why, 'fail', 'reviewer');
  r.transit('reviewer-done', 300, { tone: j.wrong ? 'fail' : 'ok' }).node('done', j.wrong ? 'fail' : 'ok', 'DONE');
  return r.end(j.wrong ? 'DONE — on unproven evidence' : 'DONE — evidence holds', j.wrong ? 'fail' : 'ok');
}

export const typedEvidenceChain: PatternSim = {
  slug: 'typed-evidence-chain',
  invariant: 'The evidence a builder must attach depends on the change type, and the reviewer validates that type\'s evidence.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.5,
  params: [
    { key: 'actual', label: 'Actual change type', type: 'select', default: 'BUG', options: TYPES.map((t) => ({ value: t, label: t })) },
    { key: 'routing', label: 'Router decision', type: 'select', default: 'correct', options: [{ value: 'correct', label: 'Correct' }, ...TYPES.map((t) => ({ value: t, label: `Forced: ${t}` }))] },
    { key: 'evidence', label: 'Evidence block', type: 'select', default: 'valid', options: [{ value: 'valid', label: 'Valid' }, { value: 'fabricated', label: 'Fabricated' }, { value: 'missing', label: 'Missing' }] },
    { key: 'rerun', label: 'Reviewer re-executes evidence', type: 'toggle', default: true, source: 'ai-dev-tools ADR-009' },
  ],
  graph: () => ({
    nodes: [
      { id: 'task', label: 'Task', kind: 'start', rank: 0, lane: 1 },
      { id: 'router', label: 'Router', kind: 'gate', rank: 1, lane: 1 },
      ...TYPES.map((t, i) => ({ id: t, label: `${t.toLowerCase()} builder`, kind: 'agent' as const, rank: 2, lane: i })),
      ...TYPES.map((t, i) => ({ id: `ev${t}`, label: t === 'BUG' ? 'Reproduction' : t === 'REFACTOR' ? 'Non-regression' : 'AC coverage', sub: 'patch + AC +', kind: 'store' as const, rank: 3, lane: i })),
      { id: 'reviewer', label: 'Reviewer', sub: 'type-specific rules', kind: 'agent', rank: 4, lane: 1 },
      { id: 'done', label: 'DONE / NEEDS_REVIEW', kind: 'end', rank: 5, lane: 1 },
    ],
    edges: [
      { id: 'task-router', from: 'task', to: 'router' },
      ...TYPES.map((t) => ({ id: `router-${t}`, from: 'router', to: t, label: t })),
      ...TYPES.map((t) => ({ id: `${t}-ev${t}`, from: t, to: `ev${t}` })),
      ...TYPES.map((t) => ({ id: `ev${t}-reviewer`, from: `ev${t}`, to: 'reviewer' })),
      { id: 'reviewer-done', from: 'reviewer', to: 'done' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'routed', label: 'Builder used', format: 'text' },
    { key: 'duration', label: 'Simulated duration', format: 'ms' },
  ],
  derive: (t: Trace, c) => ({ outcome: t.outcome?.label ?? '—', routed: judge(c).routed, duration: t.duration }),
  explain: (_t, c) => {
    const j = judge(c);
    const out: string[] = [];
    if (j.status === 'NEEDS_REVIEW') out.push(`${j.why}.`);
    if (j.wrong) out.push(c.rerun === false ? 'Evidence trusted as written is a claim, not proof: re-executing it is what turns a fabricated block into NEEDS_REVIEW (the ai-dev-tools incident behind ADR-009).' : 'The reviewer validates the evidence it was given; a misrouted FEATURE carries no evidence to contradict it.');
    if (!j.why && !j.wrong) out.push(`The ${j.routed} builder produced the ${BLOCK[j.routed]} the reviewer needed: no inference about what the change was meant to prove.`);
    return out;
  },
  compare: (a, b) => [`A: ${a.metrics.outcome}. B: ${b.metrics.outcome}.`],
  presets: [
    { id: 'default', label: 'Bug with reproduction', description: 'Type-specific evidence, re-executed.', kind: 'scenario', config: {} },
    { id: 'fab', label: 'Evidence fabrication', description: 'A reproduction that passes on the buggy code.', kind: 'failure', config: { evidence: 'fabricated' } },
    { id: 'misroute', label: 'Router misclassification', description: 'A refactor sent to the bug builder.', kind: 'failure', config: { actual: 'REFACTOR', routing: 'BUG' } },
    { id: 'trusted', label: 'Evidence trusted as written', description: 'Before ADR-009: no re-run.', kind: 'failure', config: { evidence: 'fabricated', rerun: false } },
  ],
  comparePresets: [
    { id: 'rerun', label: 'Trusted vs re-executed', description: 'Same fabricated reproduction.', a: { label: 'Trusted as written', config: { evidence: 'fabricated', rerun: false } }, b: { label: 'Re-executed (ADR-009)', config: { evidence: 'fabricated' } } },
  ],
};
