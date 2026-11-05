// Browser ports of the pure functions in patterns/*/impl.mjs (those import node: builtins, so the browser
// cannot load them). tests/ports.test.ts runs both against the same inputs: a drift fails the build.

// ---- tool-grounded-review: checkStatus / verdict ----
export type CheckRun = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A';
export function checkStatus(statuses: string[]): string {
  const has = (s: string) => statuses.includes(s);
  if (has('FAIL')) return has('PASS') ? 'FLAKY' : 'FAIL';
  if (has('PASS')) return 'PASS';
  if (has('N/A')) return 'N/A';
  return 'UNVERIFIED';
}
export function parseVerdict(text: string): 'APPROVED' | 'REQUEST_CHANGES' | null {
  try {
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1'));
    return parsed?.verdict === 'APPROVED' || parsed?.verdict === 'REQUEST_CHANGES' ? parsed.verdict : null;
  } catch {
    return null;
  }
}
export function gateVerdict({ evidence, review }: { evidence: { name: string; status: string }[]; review: string }, declared: string[]) {
  const status = (n: string) => checkStatus(evidence.filter((e) => e.name === n).map((e) => e.status));
  const failing = declared.filter((n) => status(n) === 'FAIL');
  const unverified = declared.filter((n) => !['PASS', 'FAIL', 'N/A'].includes(status(n)));
  const llmApproved = parseVerdict(review) === 'APPROVED';
  const blocked = failing.length > 0 || unverified.length > 0;
  const checks = Object.fromEntries(declared.map((n) => [n, status(n)]));
  return { approved: llmApproved && !blocked, overridden: llmApproved && blocked, failing, unverified, checks };
}

// ---- escalation-ladder: deterministic / checkModelAnswer ----
export interface Hunk { ours: string; base: string; theirs: string }
const MARKER = /^(<{7}|>{7})/m;
const SEPARATOR = /^(={7}|\|{7})(?: .*)?$/;
const lines = (t: string) => String(t).split('\n').map((l) => l.trim()).filter(Boolean);
export function deterministic({ ours, base, theirs }: Hunk): string | null {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;
  return null;
}
export function checkModelAnswer(hunk: Hunk, answer: unknown, { maxInvented = 1 } = {}): string | null {
  if (typeof answer !== 'string') return 'malformed';
  if (MARKER.test(answer)) return 'marker_left';
  const sides = new Set([hunk.ours, hunk.base, hunk.theirs].flatMap((t) => String(t).split('\n')));
  if (answer.split('\n').some((l) => SEPARATOR.test(l) && !sides.has(l))) return 'marker_left';
  const known = new Set([...lines(hunk.ours), ...lines(hunk.base), ...lines(hunk.theirs)]);
  return lines(answer).filter((l) => !known.has(l)).length > maxInvented ? 'invented_content' : null;
}

// ---- stateful-upgrade-verification: verifyUpgrade ----
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export function verifyUpgrade({ oldVersion, newVersion, oldState, migration, canReadInPlace = false }: { oldVersion: string; newVersion: string; oldState: Record<string, unknown> | null; migration?: ((s: Record<string, unknown>) => unknown) | null; canReadInPlace?: boolean }) {
  if (!oldVersion || !newVersion || !oldState || typeof oldState !== 'object') return { ok: false, reason: 'invalid_setup' };
  const original = structuredClone(oldState);
  let next: unknown;
  try {
    if (oldVersion === newVersion || canReadInPlace) next = structuredClone(oldState);
    else if (typeof migration === 'function') next = migration(structuredClone(oldState));
    else return { ok: false, reason: 'migration_required' };
    if (!next || typeof next !== 'object') return { ok: false, reason: 'invalid_migration' };
    for (const [key, value] of Object.entries(original)) {
      if (!Object.hasOwn(next, key) || !deepEqual((next as Record<string, unknown>)[key], value)) return { ok: false, reason: 'data_mismatch' };
    }
    return { ok: true, reason: 'verified' };
  } catch {
    return { ok: false, reason: 'migration_failed' };
  }
}

// ---- read-only-meta-loop: FORBIDDEN / LEVERS / NO_LEVER / suggest ----
export const FORBIDDEN = [/^\.github\//, /^\.claude\//, /(^|\/)(CLAUDE|AGENTS)\.md$/i, /threshold/i, /^evals\/datasets\//, /protected-paths/, /attempt/i];
export const LEVERS: Record<string, { stage: string; summary: string; targets: { ref: string; gate: string | null }[] }> = {
  'review-withheld': {
    stage: 'review',
    summary: 'Reviews are withheld on a prompt budget that does not fit the diffs',
    targets: [
      { ref: 'config/models.yaml#review_max_input_tokens', gate: 'review' },
      { ref: 'config/models.yaml#anthropic_review_max_diff_chars', gate: 'review' },
    ],
  },
  'autofix-ineffective': {
    stage: 'autofix',
    summary: 'Auto-fix attempts end without a push',
    targets: [
      { ref: 'config/models.yaml#autofix_max_input_tokens', gate: null },
      { ref: 'prompts/auto-fix-system.md', gate: null },
    ],
  },
};
export const NO_LEVER: Record<string, string> = {
  'runs-failed': 'needs a root cause first',
  escalations: 'a person is the lever',
  'review-duplicates': 'fixed in .github/, which a lever may not name',
};
export interface Finding { key: string; id: string; severity: string; status: string; fact: string; hypothesis?: string }
export function validateTable(levers = LEVERS, noLever = NO_LEVER) {
  for (const [id, entry] of Object.entries(levers)) {
    if (id in noLever) throw new Error(`${id} is both mapped and listed as having no lever`);
    for (const { ref } of entry.targets) if (FORBIDDEN.some((re) => re.test(ref))) throw new Error(`${id}: forbidden target ${ref}`);
  }
}
export function leverFor(f: Finding, levers = LEVERS) {
  if (f.status !== 'active') return null;
  if (f.severity !== 'warning' && f.severity !== 'critical') return null;
  const entry = levers[f.id];
  if (!entry) return null;
  return { stage: entry.stage, summary: entry.summary, targets: entry.targets.map((t) => ({ ...t, requires: t.gate ? `evals:${t.gate}` : 'no-eval-gate' })), verified: false };
}
function whyNot(f: Finding, noLever: Record<string, string>) {
  if (f.status !== 'active') return 'resolved';
  if (f.severity === 'info') return 'info (a guardrail doing its job)';
  return noLever[f.id] ?? 'no lever mapped';
}
export function suggest(doc: { schema_version: number; status?: string; findings: Finding[] }, { levers = LEVERS, noLever = NO_LEVER } = {}) {
  if (doc?.schema_version !== 1) throw new Error(`unsupported schema_version: ${doc?.schema_version}`);
  if (doc.status === 'no_data') return { proposals: [], notProposed: [], blocked: 'no_data' };
  const proposals: { key: string; observed: string; hypothesis: string | null; lever: NonNullable<ReturnType<typeof leverFor>> }[] = [];
  const notProposed: { key: string; reason: string }[] = [];
  for (const f of doc.findings) {
    const lever = leverFor(f, levers);
    if (lever) proposals.push({ key: f.key, observed: f.fact, hypothesis: f.hypothesis ?? null, lever });
    else notProposed.push({ key: f.key, reason: whyNot(f, noLever) });
  }
  return { proposals, notProposed, blocked: null };
}
