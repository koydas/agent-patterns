import { Recorder } from '../engine/recorder';
import type { Config, PatternSim, Trace } from '../engine/types';
import { verifyUpgrade } from './ports';

const PROBE = { 'users:1': { email: 'probe@example.test', plan: 'pro' }, 'orders:9': { total: 42 } };

const MIGRATIONS: Record<string, ((s: Record<string, unknown>) => unknown) | null> = {
  none: null,
  correct: (s) => ({ ...s, schema: 'v16' }),
  lossy: (s) => { const { ['orders:9']: _dropped, ...rest } = s; void _dropped; return rest; },
  throws: () => { throw new Error('pg_restore: incompatible archive'); },
  empty: () => null,
};

export function check(c: Config) {
  if (c.mode === 'fresh') return { ok: true, reason: 'boots on an empty volume' };
  return verifyUpgrade({ oldVersion: '15', newVersion: '16', oldState: structuredClone(PROBE), migration: MIGRATIONS[String(c.migration)], canReadInPlace: c.inPlace === true });
}

function simulate(c: Config) {
  const r = new Recorder();
  const v = check(c);
  if (c.mode === 'fresh') {
    r.node('base', 'skipped').node('seed', 'skipped').node('snapshot', 'skipped').node('upgrade', 'skipped');
    r.log('Fresh-install test only: the new version starts on an empty volume', 'warn', 'new');
    r.run('new', 1500, 'ok', 'healthy').log('Health check passes', 'ok', 'new').transit('new-read', 300).node('read', 'skipped', 'nothing to read');
    r.transit('read-gate', 300, { tone: 'warn' }).node('gate', 'ok', 'green');
    return r.end('GREEN — on empty storage', 'warn');
  }
  r.run('base', 1200, 'ok', 'v15').log('Base version starts with persistent storage', 'info', 'base');
  r.transit('base-seed', 300).run('seed', 600, 'ok', '2 records').log('Probe data written: users:1, orders:9', 'info', 'seed');
  r.transit('seed-snapshot', 300);
  if (c.snapshot === false) r.node('snapshot', 'warn', 'no copy').log('No preserved copy: a destructive trial would modify the only data', 'warn', 'snapshot');
  else r.run('snapshot', 500, 'ok', 'preserved').log('Source state preserved', 'ok', 'snapshot');
  r.transit('snapshot-upgrade', 300).node('upgrade', 'active').wait(200);
  if (c.inPlace) { r.node('upgrade', 'ok', 'in place').transit('upgrade-new', 400).log('In-place upgrade supported: v16 on the same volume', 'info', 'upgrade'); }
  else {
    r.node('upgrade', 'ok', 'migrate').transit('upgrade-migrate', 300);
    if (c.migration === 'none') {
      r.node('migrate', 'fail', 'none').log('No migration and v16 cannot read v15 data → migration_required', 'fail', 'migrate');
      r.transit('migrate-block', 400, { tone: 'fail' }).node('block', 'fail', 'migration_required');
      return r.end('BLOCKED — migration_required', 'fail');
    }
    r.node('migrate', 'active').log('Versioned dump-and-restore into a new volume', 'info', 'migrate').wait(1400);
    if (v.reason === 'migration_failed' || v.reason === 'invalid_migration') {
      r.node('migrate', 'fail', v.reason).log(`Migration ${v.reason === 'migration_failed' ? 'threw' : 'returned no state'} → ${v.reason}`, 'fail', 'migrate');
      r.transit('migrate-block', 400, { tone: 'fail' }).node('block', 'fail', v.reason);
      return r.end(`BLOCKED — ${v.reason}`, 'fail');
    }
    r.node('migrate', 'ok').transit('migrate-new', 300);
  }
  r.run('new', 1200, 'ok', 'v16').transit('new-read', 300).node('read', 'active').log('Read the original probe on v16', 'info', 'read').wait(500);
  if (!v.ok) {
    r.node('read', 'fail', v.reason).log('orders:9 is missing after migration → data_mismatch: the new version boots, the data did not survive', 'fail', 'read');
    r.transit('read-block', 400, { tone: 'fail' }).node('block', 'fail', v.reason);
    return r.end(`BLOCKED — ${v.reason}`, 'fail');
  }
  r.node('read', 'ok', 'probe intact').transit('read-gate', 300, { tone: 'ok' }).node('gate', 'ok', 'verified');
  return r.end('PASS — probe data verified on v16', 'ok');
}

export const statefulUpgradeVerification: PatternSim = {
  slug: 'stateful-upgrade-verification',
  invariant: 'An upgrade passes only if the previous version\'s real data reads back on the new one — booting on empty storage proves nothing.',
  timeUnit: 'ms',
  stochastic: false,
  timeScale: 1.6,
  params: [
    { key: 'mode', label: 'CI check', type: 'select', default: 'stateful', options: [{ value: 'stateful', label: 'Stateful verification' }, { value: 'fresh', label: 'Fresh-install only' }] },
    { key: 'inPlace', label: 'In-place upgrade supported', type: 'toggle', default: false, visibleIf: (c) => c.mode !== 'fresh' },
    { key: 'migration', label: 'Migration', type: 'select', default: 'correct', visibleIf: (c) => c.mode !== 'fresh' && c.inPlace !== true, options: [
      { value: 'correct', label: 'Correct' }, { value: 'lossy', label: 'Lossy (drops a table)' }, { value: 'throws', label: 'Throws' }, { value: 'empty', label: 'Returns nothing' }, { value: 'none', label: 'None provided' },
    ] },
    { key: 'snapshot', label: 'Preserve source state first', type: 'toggle', default: true, visibleIf: (c) => c.mode !== 'fresh' },
  ],
  graph: () => ({
    nodes: [
      { id: 'base', label: 'Base version', sub: 'v15', kind: 'agent', rank: 0, lane: 0 },
      { id: 'seed', label: 'Write probe', kind: 'store', rank: 1, lane: 0 },
      { id: 'snapshot', label: 'Preserve state', kind: 'store', rank: 2, lane: 0 },
      { id: 'upgrade', label: 'In place?', kind: 'gate', rank: 3, lane: 0 },
      { id: 'migrate', label: 'Migration', sub: 'versioned', kind: 'agent', rank: 3, lane: 1 },
      { id: 'new', label: 'New version', sub: 'v16', kind: 'agent', rank: 4, lane: 0 },
      { id: 'read', label: 'Read probe', kind: 'gate', rank: 5, lane: 0 },
      { id: 'gate', label: 'Upgrade passes', kind: 'end', rank: 6, lane: 0 },
      { id: 'block', label: 'Block release', kind: 'fail', rank: 6, lane: 1 },
    ],
    edges: [
      { id: 'base-seed', from: 'base', to: 'seed' },
      { id: 'seed-snapshot', from: 'seed', to: 'snapshot' },
      { id: 'snapshot-upgrade', from: 'snapshot', to: 'upgrade' },
      { id: 'upgrade-new', from: 'upgrade', to: 'new', label: 'yes' },
      { id: 'upgrade-migrate', from: 'upgrade', to: 'migrate', label: 'no' },
      { id: 'migrate-new', from: 'migrate', to: 'new' },
      { id: 'migrate-block', from: 'migrate', to: 'block', label: 'fails' },
      { id: 'new-read', from: 'new', to: 'read' },
      { id: 'read-gate', from: 'read', to: 'gate', label: 'pass' },
      { id: 'read-block', from: 'read', to: 'block', label: 'fail' },
    ],
    rankGap: 145,
  }),
  simulate: (c) => simulate(c),
  metrics: [
    { key: 'outcome', label: 'Final state', format: 'text' },
    { key: 'reason', label: 'verifyUpgrade() reason', format: 'text' },
    { key: 'duration', label: 'Simulated CI time', format: 'ms' },
  ],
  derive: (t: Trace, c) => ({ outcome: t.outcome?.label ?? '—', reason: c.mode === 'fresh' ? 'not run' : check(c).reason, duration: t.duration }),
  explain: (_t, c) => {
    const v = check(c);
    if (c.mode === 'fresh') return ['Green, and meaningless for an upgrade: no previous data existed to break. This is the empty-volume false confidence the pattern exists for.'];
    const out = [v.ok ? 'The probe written on v15 read back identically on v16: the upgrade path is an executable release contract.' : `Blocked with reason "${v.reason}" — the gate distinguishes migration, compatibility and read failures instead of a single red.`];
    if (c.snapshot === false) out.push('Without a preserved copy, a failed trial would have damaged the only data.');
    out.push('Forward migration passing does not prove you can roll back.');
    return out;
  },
  compare: (a, b) => [`A: ${a.metrics.outcome}. B: ${b.metrics.outcome}.`, a.config.mode !== b.config.mode ? 'Same lossy migration: the fresh-install test is green, the stateful check blocks the release.' : ''].filter(Boolean),
  presets: [
    { id: 'default', label: 'Correct migration', description: 'Probe survives.', kind: 'scenario', config: {} },
    { id: 'inplace', label: 'In-place upgrade', description: 'Same volume.', kind: 'scenario', config: { inPlace: true } },
    { id: 'lossy', label: 'Weak migration', description: 'Drops a table.', kind: 'failure', config: { migration: 'lossy' } },
    { id: 'none', label: 'No migration', description: 'Incompatible format.', kind: 'failure', config: { migration: 'none' } },
    { id: 'fresh', label: 'Empty-volume test', description: 'False confidence.', kind: 'failure', config: { mode: 'fresh', migration: 'lossy' } },
  ],
  comparePresets: [
    { id: 'fresh-vs-stateful', label: 'Fresh install vs stateful', description: 'A lossy migration under both CI checks.', a: { label: 'Fresh-install only', config: { mode: 'fresh', migration: 'lossy' } }, b: { label: 'Stateful verification', config: { migration: 'lossy' } } },
  ],
};
