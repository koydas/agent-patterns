import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';
import { gateVerdict } from './ports';

const CHECK_MS: Record<string, number> = { test: 4200, lint: 1300, typecheck: 2400 };
const STATUS_OPTS = [
  { value: 'PASS', label: 'PASS' },
  { value: 'FAIL', label: 'FAIL' },
  { value: 'UNVERIFIED', label: 'UNVERIFIED (timeout / never ran)' },
  { value: 'N/A', label: 'N/A (not declared by base or change)' },
  { value: 'FLAKY', label: 'FLAKY (FAIL then PASS on re-run)' },
  { value: 'REMOVED', label: 'Script removed by the change' },
];

/** Status selection → the evidence entries the impl would record for that check. */
function runsOf(name: string, s: string): { name: string; status: string }[] {
  if (s === 'FLAKY') return [{ name, status: 'FAIL' }, { name, status: 'PASS' }];
  if (s === 'UNVERIFIED') return [];
  if (s === 'REMOVED') return [{ name, status: 'UNVERIFIED' }]; // classifyScript: declared by base, gone in the change
  return [{ name, status: s }];
}

const declaredOf = (c: Config) => ['test', 'lint', ...(c.typecheck !== 'undeclared' ? ['typecheck'] : [])];
const REVIEW_TEXT: Record<string, string> = {
  APPROVED: '{"verdict": "APPROVED"}',
  REQUEST_CHANGES: '{"verdict": "REQUEST_CHANGES"}',
  malformed: 'LGTM — APPROVED',
};

export function decide(c: Config) {
  const declared = declaredOf(c);
  const evidence = declared.flatMap((n) => runsOf(n, String(c[n])));
  const g = gateVerdict({ evidence, review: REVIEW_TEXT[String(c.verdict)] }, declared);
  // autonomous-dev-loop policy: only FAIL forces REQUEST_CHANGES; unverified is surfaced, not blocking
  const blocked = c.policy === 'surface' ? g.failing.length > 0 : g.failing.length > 0 || g.unverified.length > 0;
  const llm = c.verdict === 'APPROVED';
  return { ...g, blocked, approved: c.mode === 'llm' ? llm : llm && !blocked, overridden: c.mode !== 'llm' && llm && blocked };
}

function simulate(c: Config) {
  const r = new Recorder();
  const declared = declaredOf(c);
  const llmOnly = c.mode === 'llm';
  const d = decide(c);
  r.set('evidence', []).node('change', 'ok').log('A code change arrives for review', 'muted', 'change');
  r.transit('change-context', 300, { advance: false }).at(300).run('context', 700, 'ok').log('Context gathered: CLAUDE.md / AGENTS.md conventions', 'info', 'context');
  if (llmOnly) {
    for (const n of declared) r.node(n, 'skipped', 'not run', 0);
    r.node('evidence', 'skipped', null, 0).node('gate', 'skipped', null, 0);
    r.log('Unsafe baseline: no check is executed — the reviewer reads the diff only', 'warn', 'context');
    r.transit('context-reviewer', 350);
  } else {
    const t0 = r.now - 700;
    let end = 0;
    const arrivals: { at: number; entry: string }[] = [];
    for (const n of declared) {
      const s = String(c[n]);
      r.transit(`change-${n}`, 300, { t: t0 });
      r.node(n, 'active', null, t0 + 300).log(`Running declared check: npm run ${n} (isolated env, empty HOME)`, 'info', n, t0 + 300);
      const dur = s === 'UNVERIFIED' ? CHECK_MS[n] * 1.6 : CHECK_MS[n];
      const t = t0 + 300 + dur;
      const tone = s === 'PASS' || s === 'N/A' ? 'ok' : s === 'FAIL' ? 'fail' : 'warn';
      const label = s === 'FLAKY' ? 'FAIL+PASS' : s === 'REMOVED' ? 'removed' : s;
      r.node(n, tone === 'ok' ? 'ok' : tone === 'fail' ? 'fail' : 'warn', label, t);
      r.log(s === 'FLAKY' ? `${n}: FAIL, then PASS on re-run → FLAKY, i.e. unverified — re-running until green is not a pass` : s === 'UNVERIFIED' ? `${n}: timed out — UNVERIFIED, never read as "nothing failed"` : s === 'REMOVED' ? `${n}: the base declares it, the change removed it → UNVERIFIED, not N/A` : `${n}: ${s}${s === 'FAIL' ? ' (output tail kept as feedback)' : ''}`, tone, n, t);
      r.transit(`${n}-evidence`, 300, { t, tone });
      arrivals.push({ at: t + 300, entry: `${n}: ${d.checks[n]}|${tone}` });
      end = Math.max(end, t + 300);
    }
    // the evidence table grows in the order results arrive, not in declaration order
    arrivals.sort((x, y) => x.at - y.at).forEach((a, i) => r.set('evidence', arrivals.slice(0, i + 1).map((x) => x.entry), a.at));
    r.at(end).node('evidence', 'ok', `${declared.length} checks`).transit('evidence-reviewer', 350);
    r.transit('context-reviewer', 350, { t: end, advance: false });
  }
  r.node('reviewer', 'active').log(llmOnly ? 'Reviewer (LLM) judges the diff' : 'Reviewer (LLM) analyzes the evidence and the diff', 'info', 'reviewer').wait(2600).count('tokens', 6000);
  const v = String(c.verdict);
  r.node('reviewer', v === 'APPROVED' ? 'ok' : v === 'malformed' ? 'warn' : 'blocked', v === 'malformed' ? 'not JSON' : v).log(v === 'malformed' ? 'Model answers "LGTM — APPROVED" in prose: not a strict JSON verdict, so not an approval' : `Model verdict: ${v}`, v === 'APPROVED' ? 'ok' : 'warn', 'reviewer');
  r.set('llm', v);
  if (llmOnly) {
    r.transit('reviewer-verdict', 400, { tone: v === 'APPROVED' ? 'ok' : 'warn', label: 'trusted' });
    r.node('verdict', d.approved ? 'ok' : 'blocked', d.approved ? 'APPROVED' : 'not approved');
    if (d.approved && declared.some((n) => ['FAIL', 'FLAKY', 'UNVERIFIED', 'REMOVED'].includes(String(c[n])))) r.log('APPROVED while a check would have failed or never ran — nothing executed, nothing stopped it', 'fail', 'verdict');
    r.transit('verdict-human', 400).node('human', 'waiting');
    return r.end(d.approved ? 'APPROVED (model only)' : 'Not approved (model only)', d.approved ? 'warn' : 'muted');
  }
  r.transit('reviewer-gate', 350).node('gate', 'active').wait(150);
  if (d.failing.length) {
    r.node('gate', 'fail', 'FAIL').log(`Gate in code: ${d.failing.join(', ')} FAIL → REQUEST_CHANGES${d.overridden ? ' — the model\'s APPROVED is overridden' : ''}`, 'fail', 'gate');
    r.transit('gate-changes', 400, { tone: 'fail' }).node('changes', 'fail', 'REQUEST_CHANGES').log('Failure output travels verbatim to the fixer', 'warn', 'changes');
    r.transit('changes-human', 400, { tone: 'fail' }).node('human', 'waiting');
    return r.end(d.overridden ? 'REQUEST_CHANGES — model approval overridden' : 'REQUEST_CHANGES', 'fail');
  }
  if (d.unverified.length) {
    const blocking = c.policy !== 'surface';
    r.node('gate', 'warn', 'UNVERIFIED').log(`${d.unverified.join(', ')} unverified → ${blocking ? 'blocks approval (fail closed, impl)' : 'surfaced to the human, not blocking (autonomous-dev-loop)'}`, 'warn', 'gate');
    r.transit('gate-policy', 400, { tone: 'warn' }).node('policy', blocking ? 'blocked' : 'warn', blocking ? 'blocked' : 'surfaced');
    r.transit('policy-human', 400, { tone: 'warn' }).node('human', 'waiting');
    if (blocking) return r.end(d.overridden ? 'BLOCKED — unverified evidence overrides APPROVED' : 'BLOCKED — unverified evidence', 'warn');
    return r.end(d.approved ? 'APPROVED with unverified checks surfaced' : 'Not approved — unverified surfaced', 'warn');
  }
  r.node('gate', 'ok', 'all PASS / N/A').transit('gate-verdict', 400, { tone: 'ok' });
  r.node('verdict', d.approved ? 'ok' : 'blocked', d.approved ? 'APPROVED' : 'not approved').log(d.approved ? 'Evidence clean: the model verdict stands' : 'Evidence clean, but the model did not approve', d.approved ? 'ok' : 'warn', 'verdict');
  r.transit('verdict-human', 400).node('human', 'waiting').log('The human gate decides with the full evidence table', 'violet', 'human');
  return r.end(d.approved ? 'APPROVED — evidence clean' : 'Not approved by the model', d.approved ? 'ok' : 'muted');
}

const statusParam = (key: string, label: string, def: string) => ({ key, label, type: 'select' as const, default: def, options: STATUS_OPTS });

export const toolGroundedReview: PatternSim = {
  slug: 'tool-grounded-review',
  invariant: 'A failing check blocks approval in code — the model\'s opinion cannot override executed evidence.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.6,
  params: [
    { key: 'mode', label: 'Review mode', type: 'select', default: 'gate', options: [
      { value: 'gate', label: 'Evidence + gate in code', note: 'the pattern' },
      { value: 'llm', label: 'LLM-only (unsafe)', note: 'intentionally unsafe baseline — not the documented implementation' },
    ] },
    statusParam('test', 'npm run test', 'FAIL'),
    statusParam('lint', 'npm run lint', 'PASS'),
    { key: 'typecheck', label: 'Type-check', type: 'select', default: 'undeclared', help: 'impl declares test and lint only; the README lists type-checkers as declared checks.', options: [{ value: 'undeclared', label: 'Not declared (impl)' }, ...STATUS_OPTS] },
    { key: 'verdict', label: 'Model verdict', type: 'select', default: 'APPROVED', options: [
      { value: 'APPROVED', label: 'APPROVED' },
      { value: 'REQUEST_CHANGES', label: 'REQUEST_CHANGES' },
      { value: 'malformed', label: 'Malformed (prose)' },
    ] },
    { key: 'policy', label: 'UNVERIFIED policy', type: 'select', default: 'block', visibleIf: (c) => c.mode !== 'llm', options: [
      { value: 'block', label: 'Block (impl, fail closed)' },
      { value: 'surface', label: 'Surface only (ADL)', note: 'autonomous-dev-loop blocks on FAIL only; timeouts must not burn fix attempts' },
    ] },
  ],
  graph: (c) => {
    const declared = declaredOf(c);
    const lanes = declared.length;
    return {
      nodes: [
        { id: 'change', label: 'Code change', kind: 'start', rank: 0, lane: lanes / 2 },
        { id: 'context', label: 'Context', sub: 'conventions', kind: 'agent', rank: 1, lane: 0 },
        ...declared.map((n, i) => ({ id: n, label: n, sub: 'declared check', kind: 'check' as const, rank: 1, lane: i + 1 })),
        { id: 'evidence', label: 'Evidence', sub: 'PASS/FAIL/UNVERIFIED', kind: 'store', rank: 2, lane: (lanes + 1) / 2 + 0.5 },
        { id: 'reviewer', label: 'Reviewer', sub: 'LLM', kind: 'agent', rank: 3, lane: lanes / 2 },
        { id: 'gate', label: 'Gate in code', sub: 'any FAIL?', kind: 'gate', rank: 4, lane: lanes / 2 },
        { id: 'changes', label: 'REQUEST_CHANGES', sub: '+ failure output', kind: 'fail', rank: 5, lane: lanes / 2 - 1 },
        { id: 'policy', label: 'Policy', sub: 'UNVERIFIED', kind: 'gate', rank: 5, lane: lanes / 2 },
        { id: 'verdict', label: 'LLM verdict', kind: 'end', rank: 5, lane: lanes / 2 + 1 },
        { id: 'human', label: 'Human gate', kind: 'human', rank: 6, lane: lanes / 2 },
      ],
      edges: [
        { id: 'change-context', from: 'change', to: 'context' },
        ...declared.map((n) => ({ id: `change-${n}`, from: 'change', to: n })),
        ...declared.map((n) => ({ id: `${n}-evidence`, from: n, to: 'evidence' })),
        { id: 'context-reviewer', from: 'context', to: 'reviewer' },
        { id: 'evidence-reviewer', from: 'evidence', to: 'reviewer' },
        { id: 'reviewer-gate', from: 'reviewer', to: 'gate' },
        { id: 'reviewer-verdict', from: 'reviewer', to: 'verdict', side: 'near', dashed: true, label: 'LLM-only' },
        { id: 'gate-changes', from: 'gate', to: 'changes', label: 'any FAIL' },
        { id: 'gate-policy', from: 'gate', to: 'policy', label: 'UNVERIFIED' },
        { id: 'gate-verdict', from: 'gate', to: 'verdict', label: 'clean' },
        { id: 'changes-human', from: 'changes', to: 'human' },
        { id: 'policy-human', from: 'policy', to: 'human' },
        { id: 'verdict-human', from: 'verdict', to: 'human' },
      ],
    };
  },
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'llm', label: 'Model verdict', format: 'text' },
    { key: 'gate', label: 'Gate decision', format: 'text' },
    { key: 'duration', label: 'Simulated review latency', format: 'ms', better: 'lower', hint: 'Includes the check duration.' },
  ],
  derive: (t: Trace, c) => {
    const d = decide(c);
    return {
      outcome: t.outcome?.label ?? '—',
      llm: String(t.vars.llm ?? '—'),
      gate: c.mode === 'llm' ? 'none (not executed)' : !t.outcome ? '—' : d.failing.length ? `blocked: ${d.failing.join(', ')} FAIL` : d.unverified.length ? `${c.policy === 'surface' ? 'surfaced' : 'blocked'}: ${d.unverified.join(', ')} unverified` : 'clean',
      duration: t.duration,
    };
  },
  explain: (_t, c) => {
    const d = decide(c);
    const out: string[] = [];
    if (c.mode === 'llm') {
      out.push('Intentionally unsafe baseline: nothing was executed, so the verdict is only as good as the model\'s reading of the diff.');
      if (c.verdict === 'APPROVED' && (d.failing.length || d.unverified.length)) out.push(`The model approved a change whose ${[...d.failing, ...d.unverified].join(', ')} would not pass — exactly the ADR-0024 incident.`);
      return out;
    }
    if (d.overridden) out.push(`The deterministic evidence gate prevented approval despite the model's positive verdict (${[...d.failing.map((n) => `${n} FAIL`), ...(c.policy !== 'surface' ? d.unverified.map((n) => `${n} unverified`) : [])].join(', ')}).`);
    else if (d.failing.length) out.push(`${d.failing.join(', ')} failed: REQUEST_CHANGES is forced in code, with the failure output attached for the fixer.`);
    if (d.unverified.length) out.push(c.policy === 'surface' ? `${d.unverified.join(', ')} could not be verified. Surfacing it (instead of blocking) avoids sending a fixer after an infra problem; the human sees it in the evidence table.` : `${d.unverified.join(', ')} could not be verified: the impl fails closed — a missing or flaky check is never read as "nothing failed".`);
    if (c.verdict === 'malformed') out.push('The verdict was not strict JSON: an unreadable verdict is never an approval.');
    if (!d.failing.length && !d.unverified.length && c.verdict === 'APPROVED') out.push('Every declared check passed; the model\'s approval stands and goes to the human gate.');
    return out;
  },
  compare: (a, b) => {
    const da = decide(a.config), db = decide(b.config);
    const out: string[] = [];
    if (a.config.mode !== b.config.mode) {
      const [unsafe, safe] = a.config.mode === 'llm' ? [a, b] : [b, a];
      const ds = unsafe === a ? db : da;
      out.push(`${unsafe === a ? 'A' : 'B'} trusts the model and ends "${unsafe.metrics.outcome}"; ${safe === a ? 'A' : 'B'} executes the checks and ends "${safe.metrics.outcome}".`);
      if (ds.overridden) out.push('Same model verdict, different outcome: the deterministic evidence gate prevented approval despite the model\'s positive verdict.');
      out.push(`The price: ${((Number(safe.metrics.duration) - Number(unsafe.metrics.duration)) / 1000).toFixed(1)} s more simulated review latency, spent running the checks.`);
    }
    if (a.config.policy !== b.config.policy) out.push('Same unverified evidence: "block" stops the change, "surface" lets the human decide with the gap visible.');
    return out;
  },
  presets: [
    { id: 'default', label: 'Model approves, test fails', description: 'The core case: approval overridden.', kind: 'scenario', config: {} },
    { id: 'clean', label: 'All checks pass', description: 'Evidence clean: the model verdict stands.', kind: 'scenario', config: { test: 'PASS' } },
    { id: 'flaky', label: 'Flaky test', description: 'FAIL then PASS on re-run is unverified.', kind: 'failure', config: { test: 'FLAKY' } },
    { id: 'timeout', label: 'Check timed out', description: 'UNVERIFIED: block (impl) or surface (ADL).', kind: 'failure', config: { test: 'UNVERIFIED' } },
    { id: 'removed', label: 'Change deletes the test script', description: 'No silent opt-out: a removed script is unverified.', kind: 'failure', config: { test: 'REMOVED' } },
    { id: 'malformed', label: 'Prose verdict', description: '"LGTM — APPROVED" is not an approval.', kind: 'failure', config: { test: 'PASS', verdict: 'malformed' } },
  ],
  phases: [{ label: 'Context', nodes: ['change', 'context'] }, { label: 'Checks', nodes: ['test', 'lint', 'typecheck', 'evidence'] }, { label: 'LLM review', nodes: ['reviewer'] }, { label: 'Gate in code', nodes: ['gate', 'changes', 'policy', 'verdict'] }, { label: 'Human', nodes: ['human'] }],
  comparePresets: [
    { id: 'llm-vs-gate', label: 'LLM-only vs evidence gate', description: 'The reviewer approves while the executed test fails.', caveat: 'Scenario A is an intentionally unsafe baseline, not the behavior of the documented implementation.', a: { label: 'LLM-only review (unsafe baseline)', config: { mode: 'llm' } }, b: { label: 'Deterministic evidence gate', config: {} } },
    { id: 'policy', label: 'Block vs surface UNVERIFIED', description: 'A test that timed out under the two documented policies.', a: { label: 'Block (impl)', config: { test: 'UNVERIFIED' } }, b: { label: 'Surface (autonomous-dev-loop)', config: { test: 'UNVERIFIED', policy: 'surface' } } },
  ],
  state: [{ key: 'evidence', label: 'Evidence table', empty: 'no check executed yet' }],
};
