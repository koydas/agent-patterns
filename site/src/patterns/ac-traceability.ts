import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';

// The four acceptance criteria of the impl's brief.
const AC = ['Update display name (max 50 chars)', 'Update avatar URL (https only)', 'Changes persisted to the database', 'Invalid input → 400 with a message'];
const LOC = ['profile.ts:42', 'profile.ts:58', 'repo/users.ts:17', 'routes/profile.ts:31'];
const OPTS = [
  { value: 'covered', label: '[x] covered by file:line' },
  { value: 'blocked', label: '[ ] blocked: reason' },
  { value: 'bare', label: '[ ] no justification' },
  { value: 'nolocation', label: '[x] without file:line' },
  { value: 'hallucinated', label: '[x] location does not exist' },
];

function line(i: number, s: string): string {
  switch (s) {
    case 'covered': return `[x] ${AC[i]} — ${LOC[i]}|ok`;
    case 'blocked': return `[ ] ${AC[i]} — blocked: depends on #45|warn`;
    case 'bare': return `[ ] ${AC[i]}|fail`;
    case 'nolocation': return `[x] ${AC[i]}|fail`;
    default: return `[x] ${AC[i]} — ${LOC[i].replace(/\d+$/, '940')}|accent`;
  }
}

export function review(c: Config) {
  const items = AC.map((_, i) => String(c[`ac${i}`]));
  const issues: string[] = [];
  items.forEach((s, i) => {
    if (s === 'bare') issues.push(`AC ${i + 1}: unchecked without a reason`);
    if (s === 'nolocation') issues.push(`AC ${i + 1}: checked without file:line`);
    if (s === 'hallucinated' && c.verify) issues.push(`AC ${i + 1}: ${LOC[i].replace(/\d+$/, '940')} does not exist on the branch`);
  });
  const hallucinatedPassed = !c.verify && items.filter((s) => s === 'hallucinated').length;
  return { issues, hallucinatedPassed, status: issues.length ? 'NEEDS_REVIEW' : 'DONE' };
}

function simulate(c: Config) {
  const r = new Recorder();
  const v = review(c);
  r.set('block', []).node('issue', 'ok').log(`Issue with ${AC.length} acceptance criteria`, 'muted', 'issue').transit('issue-builder', 300);
  r.run('builder', 1500).count('calls').log('Builder emits the patch and one AC line per criterion', 'info', 'builder');
  r.transit('builder-patch', 300, { advance: false }).transit('builder-ac', 300);
  r.node('patch', 'ok').node('acblock', 'ok');
  const block: string[] = [];
  AC.forEach((_, i) => { block.push(line(i, String(c[`ac${i}`]))); r.set('block', [...block]).wait(250); });
  if (c.drift) r.log('The issue\'s AC were edited after the builder ran: the block lists the old AC and nothing compares them', 'warn', 'acblock');
  r.transit('acblock-reviewer', 300, { advance: false }).transit('patch-reviewer', 300);
  r.node('reviewer', 'active').log(c.verify ? 'Reviewer reads the AC block and checks each file:line on the branch' : 'Reviewer reads the AC block — not the full diff', 'info', 'reviewer').wait(c.verify ? 1600 : 900).count('calls');
  r.node('reviewer', 'ok').transit('reviewer-check', 300).node('check', 'active').wait(150);
  for (const i of v.issues) r.log(i, 'fail', 'check');
  if (v.status === 'NEEDS_REVIEW') {
    r.node('check', 'blocked').transit('check-needs', 300, { tone: 'warn' }).node('needs', 'waiting', 'NEEDS_REVIEW');
    return r.end(`NEEDS_REVIEW — ${v.issues.length} item(s)`, 'violet');
  }
  r.node('check', 'ok').transit('check-done', 300, { tone: v.hallucinatedPassed || c.drift ? 'warn' : 'ok' }).node('done', v.hallucinatedPassed || c.drift ? 'warn' : 'ok', 'DONE');
  if (v.hallucinatedPassed) r.log(`DONE — but ${v.hallucinatedPassed} "covered" location(s) do not exist: the block was trusted as written`, 'fail', 'done');
  return r.end(v.hallucinatedPassed ? 'DONE on hallucinated coverage' : c.drift ? 'DONE against outdated AC' : 'DONE — every AC traced', v.hallucinatedPassed || c.drift ? 'warn' : 'ok');
}

export const acTraceability: PatternSim = {
  slug: 'ac-traceability',
  invariant: 'Every acceptance criterion is either checked with a file:line or explicitly blocked with a reason — anything else is NEEDS_REVIEW.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.5,
  params: [
    ...AC.map((a, i) => ({ key: `ac${i}`, label: `AC ${i + 1}: ${a}`, type: 'select' as const, default: i === 3 ? 'blocked' : 'covered', options: OPTS })),
    { key: 'verify', label: 'Verify file:line on the branch', type: 'toggle', default: false, help: 'Mitigation for hallucinated coverage; the impl\'s reviewer checks the block\'s format only.' },
    { key: 'drift', label: 'AC edited after the builder ran', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'issue', label: 'Issue with AC', kind: 'start', rank: 0, lane: 0.5 },
      { id: 'builder', label: 'Builder', sub: 'agent', kind: 'agent', rank: 1, lane: 0.5 },
      { id: 'patch', label: 'Patch', kind: 'store', rank: 2, lane: 0 },
      { id: 'acblock', label: 'AC coverage block', kind: 'store', rank: 2, lane: 1 },
      { id: 'reviewer', label: 'Reviewer', sub: 'agent', kind: 'agent', rank: 3, lane: 0.5 },
      { id: 'check', label: 'All AC checked?', kind: 'gate', rank: 4, lane: 0.5 },
      { id: 'done', label: 'DONE', kind: 'end', rank: 5, lane: 0 },
      { id: 'needs', label: 'NEEDS_REVIEW', kind: 'human', rank: 5, lane: 1 },
    ],
    edges: [
      { id: 'issue-builder', from: 'issue', to: 'builder' },
      { id: 'builder-patch', from: 'builder', to: 'patch' },
      { id: 'builder-ac', from: 'builder', to: 'acblock' },
      { id: 'patch-reviewer', from: 'patch', to: 'reviewer' },
      { id: 'acblock-reviewer', from: 'acblock', to: 'reviewer' },
      { id: 'reviewer-check', from: 'reviewer', to: 'check' },
      { id: 'check-done', from: 'check', to: 'done', label: 'yes' },
      { id: 'check-needs', from: 'check', to: 'needs', label: 'unjustified' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'covered', label: 'AC traced to code', format: 'int' },
    { key: 'flagged', label: 'Items flagged', format: 'int' },
    { key: 'trusted', label: 'Unverified "covered" claims accepted', format: 'int', better: 'lower' },
  ],
  derive: (t: Trace, c) => {
    const v = review(c);
    // known once the reviewer has read the block, not before
    const done = !!t.outcome;
    return { outcome: t.outcome?.label ?? '—', covered: done ? AC.filter((_, i) => c[`ac${i}`] === 'covered').length : NaN, flagged: done ? v.issues.length : NaN, trusted: done ? v.hallucinatedPassed || 0 : NaN };
  },
  explain: (_t, c) => {
    const v = review(c);
    const out: string[] = [];
    if (v.status === 'NEEDS_REVIEW') out.push(`Mechanically detected, no prose judgment: ${v.issues.join('; ')}.`);
    else out.push('Every [ ] has a reason and every [x] a location: the reviewer confirmed coverage without re-reading the diff.');
    if (v.hallucinatedPassed) out.push('A well-formed block is not a true block: a location that does not exist passed because nobody opened it.');
    if (c.drift) out.push('AC drift: the block is consistent with itself, not with the issue as it reads now.');
    return out;
  },
  compare: (a, b) => [`A: ${a.metrics.outcome}. B: ${b.metrics.outcome}.`],
  presets: [
    { id: 'default', label: 'Covered + one blocked', description: 'Three traced, one blocked with a reason: DONE.', kind: 'scenario', config: {} },
    { id: 'bare', label: 'Unchecked without reason', description: 'AC 2 silently skipped.', kind: 'failure', config: { ac1: 'bare' } },
    { id: 'halluc', label: 'Hallucinated coverage', description: 'A location that does not exist.', kind: 'failure', config: { ac2: 'hallucinated' } },
    { id: 'drift', label: 'AC drift', description: 'The issue changed after the build.', kind: 'failure', config: { drift: true } },
  ],
  comparePresets: [
    { id: 'verify', label: 'Trust the block vs verify it', description: 'Same hallucinated location.', a: { label: 'Block trusted (impl reviewer)', config: { ac2: 'hallucinated' } }, b: { label: 'Locations verified', config: { ac2: 'hallucinated', verify: true } } },
  ],
  state: [{ key: 'block', label: 'AC coverage block', empty: 'not produced yet' }],
};
