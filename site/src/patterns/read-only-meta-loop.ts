import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';
import { LEVERS, NO_LEVER, suggest, validateTable, type Finding } from './ports';

// The impl's own sample findings document (impl.mjs CLI entry), with editable status and severity.
const SAMPLE: Finding[] = [
  { key: 'review-withheld', id: 'review-withheld', severity: 'warning', status: 'active', fact: '7 of 12 verdicts WITHHELD', hypothesis: 'The prompt budget cuts the diff.' },
  { key: 'autofix-ineffective', id: 'autofix-ineffective', severity: 'info', status: 'active', fact: '2 of 3 attempts blocked by a protected path.' },
  { key: 'review-duplicates', id: 'review-duplicates', severity: 'warning', status: 'active', fact: '4 heads reviewed twice.' },
  { key: 'runs-failed', id: 'runs-failed', severity: 'critical', status: 'resolved', fact: '1 failed run.' },
];

export function evaluate(c: Config) {
  const findings = SAMPLE.map((f) => ({ ...f, severity: String(c[`sev:${f.key}`] ?? f.severity), status: String(c[`st:${f.key}`] ?? f.status) }));
  if (c.newRule) findings.push({ key: 'cost-spike', id: 'cost-spike', severity: 'warning', status: 'active', fact: 'Tokens per run doubled.' });
  const levers = c.forbidden ? { ...LEVERS, 'review-withheld': { ...LEVERS['review-withheld'], targets: [...LEVERS['review-withheld'].targets, { ref: 'evals/thresholds.json#review.min', gate: null }] } } : LEVERS;
  let tableError: string | null = null;
  try { validateTable(levers, NO_LEVER); } catch (e) { tableError = (e as Error).message; }
  const unmapped = findings.map((f) => f.id).filter((id) => !(id in levers) && !(id in NO_LEVER));
  return { tableError, unmapped, result: tableError ? null : suggest({ schema_version: 1, findings }, { levers }) };
}

function simulate(c: Config) {
  const r = new Recorder();
  const e = evaluate(c);
  r.set('proposals', []).set('notProposed', []).set('writes', 0);
  r.run('runs', 500, 'ok', 'redacted').transit('runs-diag', 300).run('diag', 700, 'ok', 'no LLM').log('Deterministic diagnostics: findings with a lifecycle', 'info', 'diag');
  r.transit('diag-export', 300).run('export', 400, 'ok', 'schema v1').transit('export-table', 300);
  r.node('table', 'active').wait(300);
  if (e.tableError) {
    r.node('table', 'fail', 'invalid').log(`validateTable() throws: ${e.tableError} — the test fails before anything ships`, 'fail', 'table');
    return r.end('Lever table rejected by its test', 'fail');
  }
  if (e.unmapped.length) r.log(`Exhaustiveness check: rule "${e.unmapped.join(', ')}" has no lever and no reason — a red test, not a silent gap`, 'warn', 'table');
  r.node('table', e.unmapped.length ? 'warn' : 'ok');
  const props: string[] = [];
  const nots: string[] = [];
  for (const p of e.result!.proposals) {
    r.transit('table-suggest', 300, { tone: 'accent', label: p.key }).node('suggest', 'ok', `${props.length + 1}`);
    props.push(`${p.key} → ${p.lever.targets.map((t) => t.ref.split('#')[1] ?? t.ref).join(', ')} (verified: false)|accent`);
    r.set('proposals', [...props]).log(`Lever for ${p.key}: ${p.lever.summary} — where to look, not the cause`, 'accent', 'suggest');
  }
  for (const p of e.result!.notProposed) {
    r.transit('table-obs', 250, { tone: 'muted', label: p.key }).node('obs', 'ok');
    nots.push(`${p.key}: ${p.reason}|muted`);
    r.set('notProposed', [...nots]).log(`Not proposed — ${p.key}: ${p.reason}`, 'muted', 'obs');
  }
  if (c.writeMode) {
    r.transit('suggest-pipeline', 500, { tone: 'fail' }).node('pipeline', 'fail', 'reacts').log('Anti-pattern: one issue opened per finding → the validation workflow fires on it, labels it, hands it to code generation…', 'fail', 'pipeline');
    r.set('writes', props.length + nots.length).count('writes', props.length + nots.length).count('triggered', 3 * (props.length + nots.length)).wait(1200);
    r.log('…and each one becomes a work item in the pipeline\'s own KPIs (ADR-0046)', 'fail', 'pipeline');
    return r.end(`${props.length + nots.length} writes — the loop now feeds itself`, 'fail');
  }
  if (props.length) r.transit('suggest-person', 500).node('person', 'waiting', 'applies under gates').log('A person applies a lever like any change: evals, protected paths, review, human merge', 'violet', 'person');
  return r.end(`${props.length} lever(s) suggested · 0 writes`, 'ok');
}

export const readOnlyMetaLoop: PatternSim = {
  slug: 'read-only-meta-loop',
  invariant: 'Findings in, suggested levers out — a pure function that writes nothing the pipeline could react to, from a table that may not name a gate.',
  timeUnit: 'steps',
  stochastic: false,
  timeScale: 1.2,
  params: [
    ...SAMPLE.flatMap((f) => [
      { key: `st:${f.key}`, label: `${f.key} — status`, type: 'select' as const, default: f.status, options: [{ value: 'active', label: 'active' }, { value: 'resolved', label: 'resolved' }] },
      { key: `sev:${f.key}`, label: `${f.key} — severity`, type: 'select' as const, default: f.severity, options: ['info', 'warning', 'critical'].map((v) => ({ value: v, label: v })) },
    ]),
    { key: 'newRule', label: 'A finding from a new, unmapped rule', type: 'toggle', default: false },
    { key: 'forbidden', label: 'Add a lever on an eval threshold', type: 'toggle', default: false, help: 'Failure mode: silent weakening.' },
    { key: 'writeMode', label: 'Open an issue per finding (anti-pattern)', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'runs', label: 'Run records', kind: 'store', rank: 0, lane: 0 },
      { id: 'diag', label: 'Diagnostics', sub: 'deterministic', kind: 'gate', rank: 1, lane: 0 },
      { id: 'export', label: 'Findings doc', sub: 'versioned', kind: 'store', rank: 2, lane: 0 },
      { id: 'table', label: 'Lever table', sub: 'fixed', kind: 'gate', rank: 3, lane: 0 },
      { id: 'suggest', label: 'Suggested lever', sub: 'verified: false', kind: 'agent', rank: 4, lane: 0 },
      { id: 'obs', label: 'Observation only', sub: 'with the reason', kind: 'end', rank: 4, lane: 1 },
      { id: 'person', label: 'A person applies it', kind: 'human', rank: 5, lane: 0 },
      { id: 'pipeline', label: 'Pipeline input', sub: 'issue → workflow', kind: 'fail', rank: 5, lane: 1 },
    ],
    edges: [
      { id: 'runs-diag', from: 'runs', to: 'diag' },
      { id: 'diag-export', from: 'diag', to: 'export' },
      { id: 'export-table', from: 'export', to: 'table' },
      { id: 'table-suggest', from: 'table', to: 'suggest', label: 'lever' },
      { id: 'table-obs', from: 'table', to: 'obs', label: 'none' },
      { id: 'suggest-person', from: 'suggest', to: 'person' },
      { id: 'suggest-pipeline', from: 'suggest', to: 'pipeline', dashed: true, label: 'write mode' },
      { id: 'person-diag', from: 'person', to: 'diag', side: 'far', dashed: true, label: 'resolved, or not' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'proposals', label: 'Levers suggested', format: 'int' },
    { key: 'notProposed', label: 'Not proposed (with reason)', format: 'int' },
    { key: 'writes', label: 'Writes (issues, PRs, comments)', format: 'int', better: 'lower' },
    { key: 'triggered', label: 'Pipeline runs triggered', format: 'int', better: 'lower' },
  ],
  derive: (t: Trace, c) => {
    const e = evaluate(c);
    return { outcome: t.outcome?.label ?? '—', proposals: e.result?.proposals.length ?? 0, notProposed: e.result?.notProposed.length ?? 0, writes: t.counters.writes ?? 0, triggered: t.counters.triggered ?? 0 };
  },
  explain: (_t, c) => {
    const e = evaluate(c);
    if (e.tableError) return ['A lever that names an eval threshold would automate the cheapest wrong fix: the table\'s own test refuses it.'];
    const out = ['Computed with the same table and rules as impl.mjs (LEVERS, NO_LEVER, suggest()).'];
    if (c.writeMode) out.push('Whatever the meta-loop creates comes back as input: writing issues made it a producer of its own work.');
    else out.push('Nothing was written, posted or created: the output is the only effect.');
    if (e.unmapped.length) out.push('A new rule without a lever or a reason fails the exhaustiveness check — a decision is required, not a silent gap.');
    return out;
  },
  compare: (a, b) => [`Writes: A ${a.metrics.writes}, B ${b.metrics.writes}. Pipeline runs triggered: A ${a.metrics.triggered}, B ${b.metrics.triggered}.`],
  presets: [
    { id: 'default', label: 'impl sample document', description: 'One lever, three observations.', kind: 'scenario', config: {} },
    { id: 'guardrail', label: 'Guardrail read as a defect', description: 'An info finding stays an observation.', kind: 'scenario', config: { 'sev:autofix-ineffective': 'warning' } },
    { id: 'forbidden', label: 'Silent weakening', description: 'A lever on a threshold.', kind: 'failure', config: { forbidden: true } },
    { id: 'write', label: 'Issue per finding', description: 'The first design (ADR-0046).', kind: 'failure', config: { writeMode: true } },
    { id: 'drift', label: 'Unmapped rule', description: 'A new rule with no decision.', kind: 'failure', config: { newRule: true } },
  ],
  comparePresets: [
    { id: 'write', label: 'Read-only vs issue per finding', description: 'Same findings.', a: { label: 'Issue per finding (first design)', config: { writeMode: true } }, b: { label: 'Read-only (impl)', config: {} } },
  ],
  state: [{ key: 'proposals', label: 'Proposals', empty: '—' }, { key: 'notProposed', label: 'Not proposed', empty: '—' }],
};
