import type { MetricFormat, MetricSpec, Run } from './types';

export function fmt(v: number | string | undefined, f: MetricFormat): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  switch (f) {
    case 'ms':
      return v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
    case 'pct':
      return `${Math.round(v)}%`;
    case 'units':
      return v >= 10_000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString('en-US');
    case 'x':
      return `${v.toFixed(v >= 10 ? 0 : 1)}×`;
    case 'int':
      return String(Math.round(v));
    default:
      return String(v);
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Neutral, factual sentences for the numeric metrics that differ between two runs. */
export function metricDeltas(specs: MetricSpec[], a: Run, b: Run): string[] {
  const out: string[] = [];
  for (const s of specs) {
    const va = a.metrics[s.key];
    const vb = b.metrics[s.key];
    if (typeof va !== 'number' || typeof vb !== 'number' || !Number.isFinite(va) || !Number.isFinite(vb) || va === vb || s.format === 'text') continue;
    const dir = vb > va ? 'higher' : 'lower';
    const rel = va !== 0 ? ` (${vb > va ? '+' : '−'}${Math.round((Math.abs(vb - va) / Math.abs(va)) * 100)}%)` : '';
    out.push(`${s.label}: ${fmt(va, s.format)} → ${fmt(vb, s.format)}, ${dir} in B${rel}${s.estimate ? ' — theoretical' : ''}.`);
  }
  return out;
}

/** Equal for display: identical, or both unavailable. */
export function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));
}

export type Delta = { key: string; a: number | string; b: number | string; better: 'a' | 'b' | null };

export function deltas(specs: MetricSpec[], a: Run, b: Run): Delta[] {
  return specs.map((s) => {
    const va = a.metrics[s.key];
    const vb = b.metrics[s.key];
    let better: Delta['better'] = null;
    // a value that is not available yet (NaN) is never better or worse than another
    if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb) && va !== vb && s.better) {
      better = (s.better === 'lower' ? vb < va : vb > va) ? 'b' : 'a';
    }
    return { key: s.key, a: va, b: vb, better };
  });
}
