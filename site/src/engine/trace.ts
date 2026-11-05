import type { Config, NodeStatus, PatternSim, Run, SimEvent, Tone, Trace, VarValue } from './types';

/** Sort (stable) and fold an event history into a trace. Throws on an invalid history. */
export function buildTrace(events: SimEvent[]): Trace {
  const sorted = events.map((e, i) => [e, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e);
  const counters: Record<string, number> = {};
  const vars: Record<string, VarValue> = {};
  let outcome: Trace['outcome'] = null;
  let duration = 0;
  for (const e of sorted) {
    if (!Number.isFinite(e.t) || e.t < 0) throw new Error(`invalid event time ${e.t}`);
    duration = Math.max(duration, e.type === 'transit' ? e.t + e.dur : e.t);
    if (e.type === 'count') counters[e.key] = (counters[e.key] ?? 0) + e.delta;
    else if (e.type === 'set') vars[e.key] = e.value;
    else if (e.type === 'end') {
      if (outcome) throw new Error('a trace has exactly one end event');
      outcome = { label: e.outcome, tone: e.tone };
    }
  }
  return { events: sorted, duration, outcome, counters, vars };
}

export interface NodeState {
  status: NodeStatus;
  badge: string | null;
}

export interface Transit {
  edge: string;
  p: number;
  tone?: Tone;
  label?: string;
}

export interface Frame {
  nodes: Record<string, NodeState>;
  transits: Transit[];
  /** Edges a token has fully crossed. */
  visited: Set<string>;
  counters: Record<string, number>;
  vars: Record<string, VarValue>;
  /** Index (into logs()) of the last log entry at or before the clock, -1 if none. */
  logIndex: number;
  outcome: Trace['outcome'];
  clock: number;
}

export function logs(trace: Trace) {
  return trace.events.filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log');
}

/** The state of the run at `clock`: a pure function of the history. */
export function frameAt(trace: Trace, clock: number): Frame {
  const nodes: Record<string, NodeState> = {};
  const transits: Transit[] = [];
  const visited = new Set<string>();
  const counters: Record<string, number> = {};
  const vars: Record<string, VarValue> = {};
  let logIndex = -1;
  let outcome: Trace['outcome'] = null;
  for (const e of trace.events) {
    if (e.t > clock) break;
    switch (e.type) {
      case 'node':
        nodes[e.node] = { status: e.status, badge: e.badge === undefined ? (nodes[e.node]?.badge ?? null) : e.badge };
        break;
      case 'transit': {
        const end = e.t + e.dur;
        if (clock < end) transits.push({ edge: e.edge, p: e.dur ? (clock - e.t) / e.dur : 1, tone: e.tone, label: e.label });
        else visited.add(e.edge);
        break;
      }
      case 'log':
        logIndex++;
        break;
      case 'count':
        counters[e.key] = (counters[e.key] ?? 0) + e.delta;
        break;
      case 'set':
        vars[e.key] = e.value;
        break;
      case 'end':
        outcome = { label: e.outcome, tone: e.tone };
        break;
    }
  }
  return { nodes, transits, visited, counters, vars, logIndex, outcome, clock };
}

/** Times a Step can stop at: each log entry and the end. */
export function stepTimes(trace: Trace): number[] {
  const times = new Set<number>();
  for (const e of trace.events) if (e.type === 'log' || e.type === 'end') times.add(e.t);
  times.add(trace.duration);
  return [...times].sort((a, b) => a - b);
}

export function nextStop(traces: Trace[], clock: number): number {
  const candidates = traces.flatMap((t) => stepTimes(t)).filter((t) => t > clock + 1e-6);
  return candidates.length ? Math.min(...candidates) : Math.max(...traces.map((t) => t.duration));
}

const sig = (e: SimEvent) => JSON.stringify(e);

/** True when both histories are identical up to `clock`: the visible state would not change. */
export function samePrefix(a: Trace, b: Trace, clock: number): boolean {
  const pa = a.events.filter((e) => e.t <= clock);
  const pb = b.events.filter((e) => e.t <= clock);
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) if (sig(pa[i]) !== sig(pb[i])) return false;
  // a transit started before the clock must also end at the same time
  return true;
}

export function defaults(sim: PatternSim): Config {
  return Object.fromEntries(sim.params.map((p) => [p.key, p.default]));
}

/** Coerces and clamps a partial config against the param specs; unknown keys are dropped. */
export function normalize(sim: PatternSim, partial: Partial<Config>): Config {
  const out = defaults(sim);
  for (const p of sim.params) {
    const v = partial[p.key];
    if (v === undefined) continue;
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) out[p.key] = Math.min(p.max, Math.max(p.min, Math.round(n / p.step) * p.step));
    } else if (p.type === 'toggle') {
      out[p.key] = v === true || v === 'true' || v === '1';
    } else if (p.options.some((o) => o.value === String(v))) {
      out[p.key] = String(v);
    }
  }
  return out;
}

export function runSim(sim: PatternSim, config: Config, seed: number): Run {
  const trace = buildTrace(sim.simulate(config, seed));
  return { config, seed, trace, metrics: sim.derive(trace, config, seed) };
}
