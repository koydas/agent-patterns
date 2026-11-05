// Keyed, stateless randomness. A draw depends on (seed, keys) only — never on how many draws came before —
// so two configurations of the same pattern see the same outcome for "review of round 3" whatever their
// round cap is. That is what makes Compare fair (common random numbers).

function hashKeys(seed: number, keys: (string | number)[]): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  const s = keys.join('␟');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Uniform in [0, 1), deterministic in (seed, keys). */
export function rand(seed: number, ...keys: (string | number)[]): number {
  let t = (hashKeys(seed, keys) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** True with probability p (0–1). */
export function chance(p: number, seed: number, ...keys: (string | number)[]): boolean {
  return rand(seed, ...keys) < p;
}

/** base ± spread (fraction), rounded to the ms. */
export function jitter(base: number, spread: number, seed: number, ...keys: (string | number)[]): number {
  return Math.max(1, Math.round(base * (1 + spread * (2 * rand(seed, ...keys) - 1))));
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
