import { Recorder } from '../engine/recorder';
import { metricDeltas } from '../engine/format';
import type { Config, PatternSim, Trace } from '../engine/types';

const n = (c: Config, k: string) => Number(c[k]);
// Relative billing multipliers for input tokens (Anthropic prompt caching: write 1.25×, read 0.1×). Illustrative units.
const WRITE = 1.25, READ = 0.1;

export function billing(c: Config) {
  const calls = n(c, 'calls');
  const sys = n(c, 'system'), user = n(c, 'user');
  const drift = c.drift === 'none' ? 0 : Number(c.drift);
  let cached = false;
  const rows: { hit: boolean; billed: number }[] = [];
  for (let k = 1; k <= calls; k++) {
    const invalidated = c.bleed === true || (drift && k === drift);
    let billed: number, hit = false;
    if (!c.cache) billed = sys + user;
    else if (cached && !invalidated) { billed = sys * READ + user; hit = true; }
    else { billed = sys * WRITE + user; cached = true; }
    rows.push({ hit, billed });
  }
  const baseline = calls * (sys + user);
  const total = rows.reduce((s, r) => s + r.billed, 0);
  return { rows, total, baseline, hits: rows.filter((r) => r.hit).length };
}

function simulate(c: Config) {
  const r = new Recorder();
  const b = billing(c);
  const drift = c.drift === 'none' ? 0 : Number(c.drift);
  r.set('cache', 'empty').node('sysfile', 'ok', `${n(c, 'system')} tok`).node('userfile', 'ok', '{{placeholders}}');
  b.rows.forEach((row, i) => {
    const k = i + 1;
    for (const id of ['resolver', 'cache', 'llm']) r.node(id, 'idle', null);
    r.log(`Call ${k}/${b.rows.length}${k > 1 ? ' (retry / next item)' : ''}`, 'muted');
    if (drift && k === drift) r.node('sysfile', 'warn', 'edited').log('system.md edited between calls: exact-prefix match fails, the cache is rebuilt', 'warn', 'sysfile');
    r.transit('runtime-resolver', 250, { t: r.now, advance: false }).transit('userfile-resolver', 250);
    r.node('resolver', 'active').wait(150);
    if (c.unresolved) r.node('resolver', 'fail', '{{issue_body}}').log('A placeholder has no value: "{{issue_body}}" reaches the model literally', 'fail', 'resolver');
    else r.node('resolver', 'ok');
    r.transit('resolver-prompt', 200).node('prompt', 'ok').transit('sysfile-cache', 250, { t: r.now - 450, advance: false });
    if (c.bleed) r.node('sysfile', 'warn', 'dynamic').log(k === 1 ? 'Role bleed: per-call data was put in the system prompt — it is different on every call' : 'System prompt differs again: cache miss', 'warn', 'sysfile');
    r.node('cache', !c.cache ? 'skipped' : row.hit ? 'ok' : 'warn', !c.cache ? 'off' : row.hit ? 'hit' : 'write');
    r.set('cache', !c.cache ? 'no cache_control' : row.hit ? `hit on call ${k}|ok` : `written on call ${k}|warn`);
    r.transit('cache-llm', 250, { tone: row.hit ? 'ok' : 'warn' }).transit('prompt-llm', 250, { t: r.now - 250, advance: false });
    r.run('llm', 900, c.unresolved ? 'warn' : 'ok').count('billed', Math.round(row.billed)).count(row.hit ? 'hits' : 'misses');
    r.log(`${!c.cache ? 'No caching' : row.hit ? 'Cache hit: system tokens billed at 0.1×' : 'Cache write: system tokens billed at 1.25×'} — ${Math.round(row.billed).toLocaleString('en-US')} units`, row.hit ? 'ok' : 'info', 'llm');
    r.transit('llm-out', 250).node('out', c.unresolved ? 'warn' : 'ok');
  });
  return r.end(c.unresolved ? 'Calls made on a broken prompt' : `${b.hits}/${b.rows.length} cache hits`, c.unresolved ? 'fail' : b.hits ? 'ok' : 'muted');
}

export const stagedPromptSeparation: PatternSim = {
  slug: 'staged-prompt-separation',
  invariant: 'The invariant system prompt is a separate, cacheable prefix; only the resolved user prompt changes between calls.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.2,
  params: [
    { key: 'calls', label: 'Calls to the same stage', type: 'number', min: 1, max: 10, step: 1, default: 4, help: 'Retries of a loop, or a batch.' },
    { key: 'system', label: 'System prompt size', type: 'number', min: 1000, max: 12000, step: 500, default: 6000, unit: 'units' },
    { key: 'user', label: 'User prompt size', type: 'number', min: 200, max: 8000, step: 100, default: 1500, unit: 'units' },
    { key: 'cache', label: 'cache_control on the system prompt', type: 'toggle', default: true, source: 'autonomous-dev-loop ADR-0014 (Anthropic path)' },
    { key: 'drift', label: 'system.md edited before call', type: 'select', default: 'none', options: [{ value: 'none', label: 'Never' }, ...[2, 3, 4, 5].map((k) => ({ value: String(k), label: `Call ${k}` }))] },
    { key: 'bleed', label: 'Dynamic data in the system prompt', type: 'toggle', default: false, help: 'Failure mode: role bleed.' },
    { key: 'unresolved', label: 'Unresolved placeholder', type: 'toggle', default: false },
  ],
  graph: () => ({
    nodes: [
      { id: 'sysfile', label: 'system.md', sub: 'role, guardrails', kind: 'store', rank: 0, lane: 0 },
      { id: 'userfile', label: 'user.md', sub: '{{placeholders}}', kind: 'store', rank: 0, lane: 1 },
      { id: 'runtime', label: 'Runtime data', sub: 'diff, issue', kind: 'start', rank: 0, lane: 2 },
      { id: 'cache', label: 'Prompt cache', kind: 'store', rank: 1, lane: 0 },
      { id: 'resolver', label: 'Resolver', kind: 'gate', rank: 1, lane: 1.5 },
      { id: 'prompt', label: 'User prompt', sub: 'resolved', kind: 'agent', rank: 2, lane: 1.5 },
      { id: 'llm', label: 'LLM call', kind: 'agent', rank: 3, lane: 0.75 },
      { id: 'out', label: 'Agent output', kind: 'end', rank: 4, lane: 0.75 },
    ],
    edges: [
      { id: 'sysfile-cache', from: 'sysfile', to: 'cache' },
      { id: 'userfile-resolver', from: 'userfile', to: 'resolver' },
      { id: 'runtime-resolver', from: 'runtime', to: 'resolver' },
      { id: 'resolver-prompt', from: 'resolver', to: 'prompt' },
      { id: 'cache-llm', from: 'cache', to: 'llm' },
      { id: 'prompt-llm', from: 'prompt', to: 'llm' },
      { id: 'llm-out', from: 'llm', to: 'out' },
    ],
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'billed', label: 'Input billed (relative units)', format: 'units', better: 'lower' },
    { key: 'baseline', label: 'Same calls, no caching', format: 'units', estimate: true },
    { key: 'saving', label: 'Saving vs no caching', format: 'pct', better: 'higher', estimate: true },
    { key: 'hits', label: 'Cache hits', format: 'int', better: 'higher' },
  ],
  derive: (t: Trace, c) => {
    const b = billing(c);
    const billed = t.counters.billed ?? 0;
    return { outcome: t.outcome?.label ?? '—', billed, baseline: b.baseline, saving: t.outcome ? ((b.baseline - b.total) / b.baseline) * 100 : NaN, hits: t.counters.hits ?? 0 };
  },
  explain: (_t, c) => {
    const b = billing(c);
    const out: string[] = [];
    if (!c.cache) out.push('Without cache_control the invariant system prompt is re-billed in full on every call.');
    else if (n(c, 'calls') === 1) out.push('One call: the cache write costs 25 % more and is never read — caching only pays on repeated calls.');
    else out.push(`${b.hits} of ${n(c, 'calls')} calls read the system prompt from the cache: ${Math.round(((b.baseline - b.total) / b.baseline) * 100)} % fewer billed input units than re-sending it.`);
    if (c.bleed) out.push('Putting per-call data in the system prompt makes every prefix unique: no call ever hits the cache.');
    if (c.drift !== 'none') out.push(`Editing system.md before call ${c.drift} invalidated the cached prefix: frequent edits erase the savings.`);
    if (c.unresolved) out.push('An unresolved placeholder is silent: the call succeeds, on a prompt that says "{{issue_body}}".');
    out.push('Units are illustrative: multipliers 1.25× (cache write) and 0.1× (cache read) on input tokens; no price is implied.');
    return out;
  },
  compare: (a, b) => metricDeltas(stagedPromptSeparation.metrics, a, b),
  presets: [
    { id: 'default', label: 'Retry loop, cached', description: '4 calls, one write then reads.', kind: 'scenario', config: {} },
    { id: 'once', label: 'One-shot agent', description: 'Caching yields nothing.', kind: 'scenario', config: { calls: 1 } },
    { id: 'drift', label: 'Cache bust from drift', description: 'system.md edited.', kind: 'failure', config: { drift: '2', calls: 6 } },
    { id: 'bleed', label: 'Role bleed', description: 'Dynamic data in the system prompt.', kind: 'failure', config: { bleed: true } },
    { id: 'unresolved', label: 'Unresolved placeholder', description: '{{issue_body}} reaches the model.', kind: 'failure', config: { unresolved: true } },
  ],
  comparePresets: [
    { id: 'cache', label: 'No cache vs cached', description: 'Six calls to the same stage.', a: { label: 'No cache_control', config: { calls: 6, cache: false } }, b: { label: 'Cached system prompt', config: { calls: 6 } } },
  ],
  state: [{ key: 'cache', label: 'Cache state' }],
};
