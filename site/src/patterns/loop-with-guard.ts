import { Recorder } from '../engine/recorder';
import { chance, jitter, rand } from '../engine/rng';
import { metricDeltas, plural } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const INVALID_FORMS = [
  'prose around the JSON object',
  'unknown verdict "**APPROVED**"',
  'CHANGES_REQUESTED with an empty reasons array',
  'a ```json fence plus trailing text',
];

const CODER_UNITS = 2400;
const CODER_GROWTH = 300; // previous code + reasons travel back each round
const REVIEW_UNITS = 1100;
const REPAIR_UNITS = 600; // the repair turn re-sends the previous reviewer turn

const n = (c: Config, k: string) => Number(c[k]);

function worstCase(c: Config): number {
  const attempts = c.repair === 'one' ? 2 : 1;
  let t = 0;
  for (let round = 1; round <= n(c, 'maxRounds'); round++) {
    t += CODER_UNITS + CODER_GROWTH * (round - 1) + REVIEW_UNITS * attempts + (attempts - 1) * REPAIR_UNITS;
  }
  return t;
}

function simulate(c: Config, seed: number) {
  const max = n(c, 'maxRounds');
  const attempts = c.repair === 'one' ? 2 : 1;
  const lat = n(c, 'latency');
  const r = new Recorder();
  r.node('task', 'ok').log('Task: "Write a function that reverses a string"', 'muted', 'task').transit('task-coder');

  for (let round = 1; round <= max; round++) {
    r.set('round', round);
    for (const id of ['parse', 'verdict', 'cap']) r.node(id, 'idle', null);
    r.node('coder', 'active', `round ${round}/${max}`);
    r.log(round === 1 ? `Round 1/${max} — coder writes the first version` : `Round ${round}/${max} — coder rewrites from the reviewer's reasons`, 'info', 'coder');
    r.wait(jitter(lat, 0.25, seed, 'coder', round));
    r.count('coderCalls').count('tokens', CODER_UNITS + CODER_GROWTH * (round - 1));
    if (c.refusal && round === 2) {
      r.node('coder', 'fail', 'refused');
      r.log('stop_reason: "refusal" — another round cannot fix a safety-classifier refusal', 'fail', 'coder');
      r.transit('coder-escalate', 450, { tone: 'fail' }).node('escalate', 'waiting', 'refusal');
      r.log('Escalated to the human gate with the last reasons', 'violet', 'escalate');
      return r.end('ESCALATED — refusal', 'violet');
    }
    r.node('coder', 'ok').transit('coder-reviewer');

    let valid = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      r.node('reviewer', 'active', attempt > 1 ? 'repair' : null);
      r.log(attempt === 1 ? 'Reviewer judges the code against the task (code fenced as untrusted data)' : 'Reviewer answers the repair turn', 'info', 'reviewer');
      r.wait(jitter(lat, 0.25, seed, 'reviewer', round, attempt));
      r.count('reviewerCalls').count('tokens', REVIEW_UNITS + (attempt > 1 ? REPAIR_UNITS : 0));
      r.node('reviewer', 'ok', null).transit('reviewer-parse', 250);
      r.node('parse', 'active').wait(120);
      valid = chance(n(c, 'validity') / 100, seed, 'valid', round, attempt);
      if (valid) {
        r.node('parse', 'ok').log('Verdict parses: strict JSON, known verdict, reasons present', 'ok', 'parse');
        break;
      }
      const form = INVALID_FORMS[Math.floor(rand(seed, 'form', round, attempt) * INVALID_FORMS.length)];
      r.node('parse', 'warn', `invalid ${attempt}/${attempts}`).log(`Invalid verdict (${form}) — not counted as a rejection`, 'warn', 'parse');
      if (attempt < attempts) {
        r.transit('parse-repair', 250, { tone: 'warn' });
        r.node('repair', 'active').log('Repair turn: the parse error goes back to the reviewer — no coder round spent', 'warn', 'repair');
        r.wait(150).count('repairs').node('repair', 'ok').transit('repair-reviewer', 400, { tone: 'warn' });
      }
    }
    if (!valid) {
      r.node('parse', 'fail').transit('parse-escalate', 450, { tone: 'fail' }).node('escalate', 'waiting', 'no verdict');
      r.log(attempts > 1 ? 'Still no valid verdict after the repair turn — fail closed: no verdict never approves' : 'No repair turn configured — the first malformed verdict escalates', 'fail', 'escalate');
      return r.end('ESCALATED — no valid verdict', 'violet');
    }

    r.transit('parse-verdict', 250).node('verdict', 'active').wait(120);
    if (chance(n(c, 'approval') / 100, seed, 'approve', round)) {
      r.node('verdict', 'ok', 'APPROVED').log(`APPROVED in round ${round}`, 'ok', 'verdict');
      r.transit('verdict-done', 300, { tone: 'ok' }).node('done', 'ok');
      return r.end(`APPROVED in ${plural(round, 'round')}`, 'ok');
    }
    r.node('verdict', 'blocked', 'CHANGES_REQUESTED').log('CHANGES_REQUESTED — reasons become the coder\'s feedback', 'warn', 'verdict');
    r.transit('verdict-cap', 250, { tone: 'warn' }).node('cap', 'active').wait(100);
    if (round === max) {
      r.node('cap', 'fail', `${max}/${max}`).log(`Round cap reached (${max}) — escalate with the last reasons, not just the code`, 'fail', 'cap');
      r.transit('cap-escalate', 450, { tone: 'fail' }).node('escalate', 'waiting', 'round cap');
      return r.end('ESCALATED — round cap reached', 'violet');
    }
    r.node('cap', 'ok', `${round}/${max}`).transit('cap-coder', 500, { tone: 'warn', label: 'reasons' });
  }
  return r.end('unreachable', 'fail');
}

export const loopWithGuard: PatternSim = {
  slug: 'loop-with-guard',
  invariant: 'The loop always terminates: a round cap bounds it, and a missing or malformed verdict escalates instead of approving.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 2.5,
  params: [
    { key: 'maxRounds', label: 'Max rounds (cap)', type: 'number', min: 1, max: 10, step: 1, default: 5, source: 'impl: MAX_ROUNDS = 5 · autonomous-dev-loop: 3 auto-fix attempts' },
    { key: 'approval', label: 'Review approval probability', type: 'number', min: 0, max: 100, step: 5, default: 30, unit: '%', help: 'Chance that a given round\'s code is approved (drawn per round, same draws across scenarios).' },
    { key: 'validity', label: 'Reviewer output validity', type: 'number', min: 0, max: 100, step: 5, default: 85, unit: '%', help: 'Chance that one reviewer answer parses as a strict JSON verdict.' },
    { key: 'repair', label: 'Malformed verdict handling', type: 'select', default: 'one', source: 'impl: MAX_REVIEW_ATTEMPTS = 2', options: [
      { value: 'one', label: 'One repair turn (impl)', note: 'parse error sent back to the reviewer once' },
      { value: 'none', label: 'No repair turn', note: 'first malformed verdict escalates' },
    ] },
    { key: 'latency', label: 'Simulated agent latency', type: 'number', min: 100, max: 3000, step: 100, default: 1200, unit: 'ms', help: 'Per coder or reviewer call, ±25 %.' },
    { key: 'refusal', label: 'Safety refusal in round 2', type: 'toggle', default: false, help: 'stop_reason "refusal": the impl escalates instead of retrying.' },
  ],
  graph: () => ({
    nodes: [
      { id: 'task', label: 'Task input', kind: 'start', rank: 0, lane: 0 },
      { id: 'coder', label: 'Coder', sub: 'agent', kind: 'agent', rank: 1, lane: 0 },
      { id: 'reviewer', label: 'Reviewer', sub: 'agent', kind: 'agent', rank: 2, lane: 0 },
      { id: 'parse', label: 'Valid verdict?', sub: 'strict JSON', kind: 'gate', rank: 3, lane: 0 },
      { id: 'repair', label: 'Repair turn', sub: 'reviewer side', kind: 'agent', rank: 3, lane: 1 },
      { id: 'verdict', label: 'APPROVED?', kind: 'gate', rank: 4, lane: 0 },
      { id: 'cap', label: 'Round cap?', kind: 'gate', rank: 4, lane: 1 },
      { id: 'done', label: 'Return result', kind: 'end', rank: 5, lane: 0 },
      { id: 'escalate', label: 'Human gate', sub: 'escalation', kind: 'human', rank: 6, lane: 1 },
    ],
    edges: [
      { id: 'task-coder', from: 'task', to: 'coder' },
      { id: 'coder-reviewer', from: 'coder', to: 'reviewer' },
      { id: 'reviewer-parse', from: 'reviewer', to: 'parse' },
      { id: 'parse-repair', from: 'parse', to: 'repair', label: 'no, retry' },
      { id: 'repair-reviewer', from: 'repair', to: 'reviewer', side: 'near', depth: 0 },
      { id: 'parse-verdict', from: 'parse', to: 'verdict', label: 'yes' },
      { id: 'parse-escalate', from: 'parse', to: 'escalate', label: 'exhausted' },
      { id: 'verdict-done', from: 'verdict', to: 'done', label: 'yes' },
      { id: 'verdict-cap', from: 'verdict', to: 'cap', label: 'no' },
      { id: 'cap-coder', from: 'cap', to: 'coder', label: 'next round', side: 'near', depth: 30 },
      { id: 'cap-escalate', from: 'cap', to: 'escalate', label: 'reached' },
      { id: 'coder-escalate', from: 'coder', to: 'escalate', label: 'refusal', side: 'far', dashed: true },
    ],
  }),
  simulate,
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'rounds', label: 'Rounds used', format: 'int', better: 'lower' },
    { key: 'reviewerCalls', label: 'Reviewer calls', format: 'int', better: 'lower' },
    { key: 'repairs', label: 'Repair turns', format: 'int' },
    { key: 'duration', label: 'Simulated duration', format: 'ms', better: 'lower' },
    { key: 'tokens', label: 'Simulated tokens', format: 'units', better: 'lower' },
    { key: 'worst', label: 'Cost ceiling at this cap', format: 'units', estimate: true, hint: 'Every round rejected, every verdict repaired: the most this configuration can spend.' },
  ],
  derive: (t: Trace, c) => ({
    outcome: t.outcome?.label ?? '—',
    rounds: Number(t.vars.round ?? 0),
    reviewerCalls: t.counters.reviewerCalls ?? 0,
    repairs: t.counters.repairs ?? 0,
    duration: t.duration,
    tokens: t.counters.tokens ?? 0,
    worst: worstCase(c),
  }),
  explain: (t, c) => {
    const max = n(c, 'maxRounds');
    const rounds = Number(t.vars.round ?? 0);
    const out: string[] = [];
    const label = t.outcome?.label ?? '';
    if (label.startsWith('APPROVED')) out.push(`Approved in round ${rounds} of ${max}. The cap was never hit, but it is what bounds the worst case at ${worstCase(c).toLocaleString('en-US')} simulated tokens; this run used ${(t.counters.tokens ?? 0).toLocaleString('en-US')}.`);
    if (label.includes('round cap')) out.push(`Every one of the ${max} rounds was rejected: the cap stopped the loop and handed the human the last reasons instead of looping forever.`);
    if (label.includes('no valid verdict')) out.push(c.repair === 'one' ? 'The reviewer failed to produce a valid verdict twice in one round: the loop failed closed. A missing verdict is a system fault, never an approval and never a code rejection.' : 'Without a repair turn, a single malformed verdict escalates — a format error ends the run even when the code may be fine.');
    if (label.includes('refusal')) out.push('A safety-classifier refusal escalates immediately: another round cannot change it.');
    const repairs = t.counters.repairs ?? 0;
    if (repairs > 0 && !label.includes('no valid verdict')) out.push(`${plural(repairs, 'malformed verdict')} repaired on the reviewer side without spending a coder round.`);
    return out;
  },
  compare: (a, b) => {
    const out: string[] = [];
    const ra = Number(a.metrics.rounds), rb = Number(b.metrics.rounds);
    if (a.metrics.outcome !== b.metrics.outcome) out.push(`Same seeded review outcomes, different configuration: A ends "${a.metrics.outcome}", B ends "${b.metrics.outcome}".`);
    if (a.config.maxRounds !== b.config.maxRounds) {
      const extra = Number(b.config.maxRounds) - Number(a.config.maxRounds);
      out.push(extra > 0
        ? `Raising the cap by ${extra} gave B up to ${plural(extra, 'more attempt')} (it used ${rb} vs ${ra}) and raised its cost ceiling from ${Number(a.metrics.worst).toLocaleString('en-US')} to ${Number(b.metrics.worst).toLocaleString('en-US')} simulated tokens.`
        : `Lowering the cap by ${-extra} cut B's cost ceiling to ${Number(b.metrics.worst).toLocaleString('en-US')} simulated tokens — and its chances to converge.`);
    }
    if (a.config.repair !== b.config.repair) out.push('The repair turn turns a one-off formatting error into a cheap reviewer retry instead of an escalation.');
    return [...out, ...metricDeltas(loopWithGuard.metrics, a, b)];
  },
  presets: [
    { id: 'default', label: 'Default (impl)', description: 'MAX_ROUNDS = 5, one repair turn.', kind: 'scenario', config: {} , seed: 7 },
    { id: 'converges', label: 'Converges quickly', description: 'A reviewer that approves most rounds.', kind: 'scenario', config: { approval: 70, validity: 95 }, seed: 3 },
    { id: 'never', label: 'Reviewer never approves', description: 'Criteria the coder cannot meet: the cap is always hit.', kind: 'failure', config: { approval: 0 } },
    { id: 'prose', label: 'Reviewer emits prose', description: 'Every verdict is malformed: repair, then fail closed.', kind: 'failure', config: { validity: 0 } },
    { id: 'flaky', label: 'Flaky verdict format', description: 'Half the answers are malformed; the repair turn absorbs most.', kind: 'failure', config: { validity: 50, approval: 40 }, seed: 11 },
    { id: 'refusal', label: 'Safety refusal', description: 'The coder is refused in round 2.', kind: 'failure', config: { refusal: true, approval: 0 } },
  ],
  phases: [{ label: 'Generation', nodes: ['task', 'coder'] }, { label: 'Review', nodes: ['reviewer', 'parse', 'repair'] }, { label: 'Verdict', nodes: ['verdict', 'cap'] }, { label: 'Result', nodes: ['done', 'escalate'] }],
  comparePresets: [
    { id: 'cap', label: 'Cap 2 vs cap 5', description: 'Same rejection-heavy reviewer, same seeded draws — only the cap changes.', a: { label: 'Max 2 rounds', config: { maxRounds: 2, approval: 25 } }, b: { label: 'Max 5 rounds', config: { maxRounds: 5, approval: 25 } }, seed: 4 },
    { id: 'repair', label: 'Repair turn vs none', description: 'Same malformed-verdict rate; B escalates on the first format error.', a: { label: 'One repair turn', config: { validity: 55, approval: 40 } }, b: { label: 'No repair turn', config: { validity: 55, approval: 40, repair: 'none' } }, seed: 2 },
  ],
};
