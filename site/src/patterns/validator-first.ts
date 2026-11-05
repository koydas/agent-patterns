import { Recorder } from '../engine/recorder';
import { chance, rand } from '../engine/rng';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);
const VALIDATOR_UNITS = 400; // low effort, small max_tokens
const PIPELINE_UNITS = 9000;

type Raw = { text: string; kind: 'json-valid' | 'json-refine' | 'bold-valid' | 'prose-valid-no' };

/** What the validator emits for issue i. */
function output(c: Config, seed: number, i: number, wellSpecified: boolean): Raw {
  const correct = chance(n(c, 'accuracy') / 100, seed, 'acc', i);
  const says = correct === wellSpecified ? 'VALID' : 'NEEDS_REFINEMENT';
  if (!chance(n(c, 'malformed') / 100, seed, 'fmt', i)) return says === 'VALID' ? { text: '{"verdict":"VALID"}', kind: 'json-valid' } : { text: '{"verdict":"NEEDS_REFINEMENT"}', kind: 'json-refine' };
  // the two malformed forms the README names: a bold verdict, and prose that starts with the word
  return rand(seed, 'form', i) < 0.5 ? { text: '**VALID**', kind: 'bold-valid' } : { text: 'VALID? No — needs refinement', kind: 'prose-valid-no' };
}

function parse(c: Config, raw: Raw): 'VALID' | 'NEEDS_REFINEMENT' | 'error' {
  if (c.parsing === 'prefix') return raw.text.startsWith('VALID') ? 'VALID' : 'NEEDS_REFINEMENT';
  if (raw.kind === 'json-valid') return 'VALID';
  if (raw.kind === 'json-refine') return 'NEEDS_REFINEMENT';
  return 'error';
}

function simulate(c: Config, seed: number) {
  const r = new Recorder();
  const N = n(c, 'issues');
  const gate = c.gate !== false;
  for (let i = 0; i < N; i++) {
    const well = !chance(n(c, 'vague') / 100, seed, 'vague', i);
    for (const id of ['validator', 'parse', 'valid', 'pipeline', 'refine', 'fault']) r.node(id, 'idle', null);
    r.node('issue', 'active', `#${i + 1}`).log(`Issue #${i + 1}: ${well ? 'well-specified' : 'under-specified ("Fix the bug")'}`, 'muted', 'issue');
    if (!gate) {
      r.transit('issue-pipeline', 400, { label: `#${i + 1}`, tone: well ? 'accent' : 'warn' });
      r.run('pipeline', 1200, well ? 'ok' : 'warn').count('tokens', PIPELINE_UNITS).count('generated');
      if (!well) r.count('wasted').log('No gate: generation runs on a vague issue — a garbage PR', 'fail', 'pipeline');
      else r.log('Generation on a good issue', 'ok', 'pipeline');
      continue;
    }
    r.transit('issue-validator', 300, { label: `#${i + 1}` });
    r.run('validator', 400).count('tokens', VALIDATOR_UNITS);
    const raw = output(c, seed, i, well);
    r.transit('validator-parse', 250).node('parse', 'active').wait(100);
    const v = parse(c, raw);
    r.log(`Validator says ${raw.text}`, 'info', 'validator');
    if (v === 'error') {
      r.node('parse', 'fail').transit('parse-fault', 300, { tone: 'fail' }).node('fault', 'fail', `#${i + 1}`).count('errors');
      r.log('Not a strict JSON verdict → label validator-error: the fault is the validator\'s, it goes to a human, not to the issue author', 'fail', 'fault');
      if (well) r.count('blockedGood');
      continue;
    }
    r.node('parse', 'ok').transit('parse-valid', 250).node('valid', 'active').wait(80);
    if (v === 'VALID') {
      r.node('valid', 'ok').transit('valid-pipeline', 300, { tone: well ? 'ok' : 'warn' });
      r.run('pipeline', 1200, well ? 'ok' : 'warn').count('tokens', PIPELINE_UNITS).count('generated');
      if (!well) { r.count('wasted'); r.log(raw.kind === 'prose-valid-no' ? 'Prefix match read "VALID? No…" as VALID: a vague issue reached generation' : 'False positive: a vague issue passed the gate', 'fail', 'pipeline'); }
      else r.log('Pipeline runs on a well-specified issue', 'ok', 'pipeline');
    } else {
      r.node('valid', 'blocked').transit('valid-refine', 300, { tone: 'warn' }).node('refine', 'blocked', `#${i + 1}`);
      if (well) { r.count('blockedGood'); r.log(raw.kind === 'bold-valid' ? 'Prefix match missed "**VALID**": a valid issue was blocked' : 'False negative: a valid issue was blocked', 'fail', 'refine'); }
      else { r.count('saved'); r.log('Blocked + needs-refinement: no tokens spent on generation', 'ok', 'refine'); }
    }
  }
  r.node('issue', 'ok', null);
  return r.end(`${N} issues processed`, 'ok');
}

export const validatorFirst: PatternSim = {
  slug: 'validator-first',
  invariant: 'Nothing enters the pipeline without a strictly parsed VALID verdict; a validator fault is labelled as the validator\'s.',
  timeUnit: 'ms',
  stochastic: true,
  timeScale: 2.5,
  params: [
    { key: 'gate', label: 'Validator gate', type: 'toggle', default: true },
    { key: 'issues', label: 'Issues', type: 'number', min: 1, max: 12, step: 1, default: 8 },
    { key: 'vague', label: 'Under-specified share', type: 'number', min: 0, max: 100, step: 5, default: 40, unit: '%' },
    { key: 'accuracy', label: 'Validator accuracy', type: 'number', min: 50, max: 100, step: 5, default: 90, unit: '%', visibleIf: (c) => c.gate !== false },
    { key: 'malformed', label: 'Malformed verdict rate', type: 'number', min: 0, max: 100, step: 5, default: 15, unit: '%', visibleIf: (c) => c.gate !== false },
    { key: 'parsing', label: 'Verdict parsing', type: 'select', default: 'strict', visibleIf: (c) => c.gate !== false, options: [
      { value: 'strict', label: 'Strict JSON (impl)' },
      { value: 'prefix', label: 'startsWith("VALID")', note: 'the brittle parser in Failure modes' },
    ] },
  ],
  graph: () => ({
    nodes: [
      { id: 'issue', label: 'Issue', kind: 'start', rank: 0, lane: 0 },
      { id: 'validator', label: 'Validator', sub: 'effort: low', kind: 'agent', rank: 1, lane: 0 },
      { id: 'parse', label: 'Valid JSON?', kind: 'gate', rank: 2, lane: 0 },
      { id: 'fault', label: 'validator-error', kind: 'fail', rank: 3, lane: 1 },
      { id: 'valid', label: 'VALID?', kind: 'gate', rank: 3, lane: 0 },
      { id: 'refine', label: 'needs-refinement', kind: 'fail', rank: 4, lane: 1 },
      { id: 'pipeline', label: 'Main pipeline', sub: 'effort: medium', kind: 'agent', rank: 4, lane: 0 },
    ],
    edges: [
      { id: 'issue-validator', from: 'issue', to: 'validator' },
      { id: 'validator-parse', from: 'validator', to: 'parse' },
      { id: 'parse-fault', from: 'parse', to: 'fault', label: 'no' },
      { id: 'parse-valid', from: 'parse', to: 'valid', label: 'yes' },
      { id: 'valid-pipeline', from: 'valid', to: 'pipeline', label: 'VALID' },
      { id: 'valid-refine', from: 'valid', to: 'refine', label: 'NEEDS_REFINEMENT' },
      { id: 'issue-pipeline', from: 'issue', to: 'pipeline', side: 'far', dashed: true, label: 'no gate' },
    ],
  }),
  simulate,
  metrics: [
    { key: 'generated', label: 'Generation runs', format: 'int' },
    { key: 'wasted', label: 'Runs on vague issues', format: 'int', better: 'lower' },
    { key: 'saved', label: 'Vague issues stopped', format: 'int', better: 'higher' },
    { key: 'blockedGood', label: 'Valid issues blocked', format: 'int', better: 'lower' },
    { key: 'errors', label: 'validator-error', format: 'int' },
    { key: 'tokens', label: 'Simulated tokens', format: 'units', better: 'lower' },
  ],
  derive: (t: Trace) => ({ generated: t.counters.generated ?? 0, wasted: t.counters.wasted ?? 0, saved: t.counters.saved ?? 0, blockedGood: t.counters.blockedGood ?? 0, errors: t.counters.errors ?? 0, tokens: t.counters.tokens ?? 0 }),
  explain: (t, c) => {
    const out: string[] = [];
    if (c.gate === false) out.push(`Without the gate every issue reached generation: ${t.counters.wasted ?? 0} runs went to issues that could not succeed.`);
    else {
      out.push(`The gate stopped ${t.counters.saved ?? 0} vague issue(s) for ${VALIDATOR_UNITS} simulated tokens each, instead of ${PIPELINE_UNITS} for a generation run.`);
      if (c.parsing === 'prefix' && ((t.counters.wasted ?? 0) || (t.counters.blockedGood ?? 0))) out.push('startsWith("VALID") both blocks "**VALID**" and passes "VALID? No…": a structured verdict removes both errors.');
      if (t.counters.errors) out.push(`${t.counters.errors} unparseable verdict(s) failed closed with their own label, validator-error — a system fault is not the issue author's to fix.`);
    }
    return out;
  },
  compare: (a, b) => metricDeltas(validatorFirst.metrics, a, b),
  presets: [
    { id: 'default', label: 'Gate on (impl)', description: 'Strict parsing, low-effort validator.', kind: 'scenario', config: {} },
    { id: 'prefix', label: 'Brittle parsing', description: 'startsWith("VALID") with malformed verdicts.', kind: 'failure', config: { parsing: 'prefix', malformed: 60 } },
    { id: 'strictfault', label: 'Prose verdicts, strict', description: 'Same malformed rate, strict parser.', kind: 'failure', config: { malformed: 60 } },
    { id: 'lenient', label: 'Lenient validator', description: '60 % accuracy: false positives and negatives.', kind: 'failure', config: { accuracy: 60 } },
  ],
  comparePresets: [
    { id: 'gate', label: 'No gate vs gate', description: 'Same issues: generation on everything vs a cheap gate first.', a: { label: 'No validator', config: { gate: false } }, b: { label: 'validator-first', config: {} } },
    { id: 'parse', label: 'Prefix vs strict parsing', description: 'Same malformed verdicts, two parsers.', a: { label: 'startsWith("VALID")', config: { parsing: 'prefix', malformed: 50 } }, b: { label: 'Strict JSON', config: { malformed: 50 } } },
  ],
};
