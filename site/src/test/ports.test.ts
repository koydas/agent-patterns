// The browser ports must behave exactly like the repository's impl.mjs (which import node: builtins).
import * as tgr from '../../../patterns/tool-grounded-review/impl.mjs';
import * as ladder from '../../../patterns/escalation-ladder/impl.mjs';
import * as upgrade from '../../../patterns/stateful-upgrade-verification/impl.mjs';
import * as meta from '../../../patterns/read-only-meta-loop/impl.mjs';
import * as port from '../patterns/ports';

const STATUSES = ['PASS', 'FAIL', 'UNVERIFIED', 'N/A'];
const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

describe('tool-grounded-review port', () => {
  it('checkStatus matches impl on every combination of runs', () => {
    for (const s of subsets(STATUSES)) expect(port.checkStatus(s)).toBe(tgr.checkStatus(s));
  });
  it('verdict matches impl on every evidence × review combination', () => {
    const reviews = ['{"verdict":"APPROVED"}', '{"verdict":"REQUEST_CHANGES"}', '```json\n{"verdict":"APPROVED"}\n```', 'LGTM — APPROVED', ''];
    for (const t of subsets(STATUSES)) for (const l of [['PASS'], ['FAIL'], [], ['N/A']]) for (const review of reviews) {
      const evidence = [...t.map((status) => ({ name: 'test', status })), ...l.map((status) => ({ name: 'lint', status }))];
      expect(port.gateVerdict({ evidence, review }, ['test', 'lint'])).toEqual(tgr.verdict({ evidence, review }, ['test', 'lint']));
    }
  });
});

describe('escalation-ladder port', () => {
  const hunks = [
    { ours: 'a', base: 'a', theirs: 'b' }, { ours: 'a', base: 'b', theirs: 'b' }, { ours: 'x', base: 'y', theirs: 'x' },
    { ours: '- ours', base: '', theirs: '- theirs' }, { ours: 'title\n=======', base: '', theirs: 'other' },
  ];
  const answers = ['- theirs\n- ours', '<<<<<<< ours\nx', '=======', '- made up\n- also made up', '- ours\n- one new', 42, 'title\n======='];
  it('deterministic() matches impl', () => {
    for (const h of hunks) expect(port.deterministic(h)).toBe(ladder.deterministic(h));
  });
  it('checkModelAnswer() matches impl', () => {
    for (const h of hunks) for (const a of answers) expect(port.checkModelAnswer(h, a)).toBe(ladder.checkModelAnswer(h, a));
  });
});

describe('stateful-upgrade-verification port', () => {
  const state = { 'users:1': { email: 'p@x', plan: 'pro' }, 'orders:9': { total: 42 } };
  const migrations = [undefined, (s: object) => ({ ...s, v: 2 }), (s: Record<string, unknown>) => ({ 'users:1': s['users:1'] }), () => { throw new Error('x'); }, () => null, (s: object) => ({ ...s, 'orders:9': { total: '42' } })];
  it('verifyUpgrade() matches impl', () => {
    for (const migration of migrations) for (const canReadInPlace of [false, true]) for (const [o, n] of [['15', '16'], ['16', '16'], ['', '16']]) {
      const args = { oldVersion: o, newVersion: n, oldState: structuredClone(state), migration, canReadInPlace };
      expect(port.verifyUpgrade(args)).toEqual(upgrade.verifyUpgrade({ ...args, oldState: structuredClone(state) }));
    }
    expect(port.verifyUpgrade({ oldVersion: '1', newVersion: '2', oldState: null })).toEqual(upgrade.verifyUpgrade({ oldVersion: '1', newVersion: '2', oldState: null }));
  });
});

describe('read-only-meta-loop port', () => {
  it('uses the same lever table', () => {
    expect(port.LEVERS).toEqual(JSON.parse(JSON.stringify(meta.LEVERS)));
    expect(port.NO_LEVER).toEqual({ ...meta.NO_LEVER });
  });
  it('suggest() matches impl for every status × severity of every sample finding', () => {
    for (const id of ['review-withheld', 'autofix-ineffective', 'review-duplicates', 'runs-failed', 'unknown-rule']) {
      for (const status of ['active', 'resolved']) for (const severity of ['info', 'warning', 'critical']) {
        const doc = { schema_version: 1, findings: [{ key: id, id, severity, status, fact: 'f', hypothesis: 'h' }] };
        expect(port.suggest(doc)).toEqual(meta.suggest(doc));
      }
    }
  });
  it('validateTable() rejects the same forbidden targets', () => {
    for (const ref of ['.github/workflows/x.yml', 'CLAUDE.md', 'evals/thresholds.json#min', 'config/models.yaml#x', 'config/protected-paths.yaml']) {
      const levers = { r: { stage: 's', summary: 's', targets: [{ ref, gate: null }] } };
      let a = null, b = null;
      try { port.validateTable(levers, {}); } catch (e) { a = (e as Error).message; }
      try { meta.validateTable(levers, {}); } catch (e) { b = (e as Error).message; }
      expect(a).toBe(b);
    }
  });
});
