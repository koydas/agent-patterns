import { defaults, normalize } from './trace';
import type { Config, PatternSim } from './types';

// Shareable state: ?seed=7&maxRounds=3 (Explore) or ?mode=compare&seed=4&a.maxRounds=2&b.maxRounds=5.
// Only values that differ from the defaults are written, so URLs stay short.

export type Mode = 'explore' | 'compare';

export interface UrlState {
  mode: Mode;
  config: Config;
  seed: number;
  a: Config;
  b: Config;
  seedA: number;
  seedB: number;
}

const DEFAULT_SEED = 7;

function readConfig(sim: PatternSim, params: URLSearchParams, prefix: string): Config {
  const partial: Record<string, string> = {};
  for (const p of sim.params) {
    const v = params.get(prefix + p.key);
    if (v !== null) partial[p.key] = v;
  }
  return normalize(sim, partial);
}

const seedOf = (v: string | null, fallback: number) => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function readUrl(sim: PatternSim, search: string): UrlState {
  const params = new URLSearchParams(search);
  const seed = seedOf(params.get('seed'), DEFAULT_SEED);
  return {
    mode: params.get('mode') === 'compare' ? 'compare' : 'explore',
    config: readConfig(sim, params, ''),
    seed,
    a: readConfig(sim, params, 'a.'),
    b: readConfig(sim, params, 'b.'),
    seedA: seedOf(params.get('sa'), seed),
    seedB: seedOf(params.get('sb'), seed),
  };
}

function writeConfig(sim: PatternSim, out: URLSearchParams, c: Config, prefix: string) {
  const d = defaults(sim);
  for (const p of sim.params) if (c[p.key] !== d[p.key]) out.set(prefix + p.key, String(c[p.key]));
}

export function toSearch(sim: PatternSim, s: Partial<UrlState> & { mode: Mode }): string {
  const out = new URLSearchParams();
  if (s.mode === 'compare') {
    out.set('mode', 'compare');
    if (s.a) writeConfig(sim, out, s.a, 'a.');
    if (s.b) writeConfig(sim, out, s.b, 'b.');
    if (s.seedA !== undefined && s.seedA !== DEFAULT_SEED) out.set('sa', String(s.seedA));
    if (s.seedB !== undefined && s.seedB !== DEFAULT_SEED) out.set('sb', String(s.seedB));
  } else {
    if (s.config) writeConfig(sim, out, s.config, '');
    if (s.seed !== undefined && s.seed !== DEFAULT_SEED) out.set('seed', String(s.seed));
  }
  const q = out.toString();
  return q ? `?${q}` : '';
}

export { DEFAULT_SEED };
