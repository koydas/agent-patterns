// Core types of the simulation engine. A pattern is a pure function config + seed → event history;
// everything the visitor sees (diagram state, timeline, metrics, explanations) is derived from that history.

export type NodeKind = 'start' | 'agent' | 'gate' | 'store' | 'check' | 'human' | 'end' | 'fail' | 'worker' | 'effect';
export type NodeStatus = 'idle' | 'active' | 'waiting' | 'ok' | 'fail' | 'blocked' | 'skipped' | 'warn';
export type Tone = 'info' | 'ok' | 'warn' | 'fail' | 'muted' | 'accent' | 'violet';

export interface GraphNode {
  id: string;
  label: string;
  /** Second line, hidden in compact layouts. */
  sub?: string;
  kind: NodeKind;
  /** Position along the flow (column in LR, row in TD). */
  rank: number;
  /** Position across the flow (row in LR, column in TD). Fractional values are allowed. */
  lane: number;
  size?: 'sm' | 'md' | 'tile' | 'icon';
  /** Icon name (components/Icons) shown on tile and icon nodes. */
  icon?: string;
  /** Resting border color, before any status. */
  tone?: 'accent' | 'ok' | 'violet' | 'muted';
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Back edges and same-rank edges loop on one side of the flow. */
  side?: 'near' | 'far';
  /** Extra loop depth, to separate parallel back edges. */
  depth?: number;
  /** Offset along the flow, to separate two edges between the same pair of same-rank nodes. */
  shift?: number;
  dashed?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Tighter spacing along the flow in left-to-right layouts, for long chains. */
  rankGap?: number;
}

export type SimEvent =
  | { t: number; type: 'node'; node: string; status: NodeStatus; badge?: string | null }
  | { t: number; type: 'transit'; edge: string; dur: number; tone?: Tone; label?: string }
  | { t: number; type: 'log'; text: string; tone?: Tone; node?: string }
  | { t: number; type: 'count'; key: string; delta: number }
  | { t: number; type: 'set'; key: string; value: VarValue }
  | { t: number; type: 'end'; outcome: string; tone: Tone };

export type VarValue = string | number | boolean | string[];
export type ConfigValue = number | string | boolean;
export type Config = Record<string, ConfigValue>;

interface ParamBase {
  key: string;
  label: string;
  help?: string;
  /** Where the value comes from in the repo (e.g. "impl: MAX_ROUNDS = 5"). */
  source?: string;
  visibleIf?: (c: Config) => boolean;
}
export interface NumberParam extends ParamBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: 'ms' | '%' | 'x' | '' | 's' | 'units';
}
export interface SelectParam extends ParamBase {
  type: 'select';
  default: string;
  options: { value: string; label: string; note?: string }[];
}
export interface ToggleParam extends ParamBase {
  type: 'toggle';
  default: boolean;
}
export type Param = NumberParam | SelectParam | ToggleParam;

export interface Preset {
  id: string;
  label: string;
  description: string;
  kind: 'scenario' | 'failure';
  config: Config;
  seed?: number;
}

export interface ComparePreset {
  id: string;
  label: string;
  description: string;
  a: { label: string; config: Config };
  b: { label: string; config: Config };
  seed?: number;
  /** Shown above the comparison, e.g. "Scenario A is an intentionally unsafe baseline". */
  caveat?: string;
}

export type MetricFormat = 'ms' | 'int' | 'pct' | 'units' | 'x' | 'text';

export interface MetricSpec {
  key: string;
  label: string;
  format: MetricFormat;
  /** Which direction counts as an improvement in Compare mode; omitted = neutral. */
  better?: 'lower' | 'higher';
  /** Values derived from the counterfactual run of the same simulator, not from this history. */
  estimate?: boolean;
  hint?: string;
}

export interface Trace {
  events: SimEvent[];
  duration: number;
  outcome: { label: string; tone: Tone } | null;
  counters: Record<string, number>;
  vars: Record<string, VarValue>;
}

export interface PatternSim {
  slug: string;
  /** The architectural invariant the visualization demonstrates, one sentence. */
  invariant: string;
  params: Param[];
  graph: (c: Config) => Graph;
  simulate: (c: Config, seed: number) => SimEvent[];
  metrics: MetricSpec[];
  /** Final metric values computed from the trace (and, for estimates, a counterfactual run). */
  derive: (trace: Trace, c: Config, seed: number) => Record<string, number | string>;
  explain: (trace: Trace, c: Config, seed: number) => string[];
  compare?: (a: Run, b: Run) => string[];
  presets: Preset[];
  comparePresets: ComparePreset[];
  /** 'ms' = simulated milliseconds; 'steps' = logical steps, duration is not a meaningful metric. */
  timeUnit: 'ms' | 'steps';
  /** Uses seeded randomness (shows the seed control). */
  stochastic: boolean;
  /** Simulated ms per wall-clock ms at 1×. */
  timeScale?: number;
  /** Named stages of the flow, shown as a stepper; a phase is current while one of its nodes is the last to start. */
  phases?: { label: string; nodes: string[]; status?: NodeStatus[] }[];
  /** Run variables shown next to the diagram (label set, ledger, …), in this order. */
  state?: { key: string; label: string; empty?: string }[];
}

export interface Run {
  config: Config;
  seed: number;
  trace: Trace;
  metrics: Record<string, number | string>;
}
