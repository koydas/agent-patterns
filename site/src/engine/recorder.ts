import type { NodeStatus, SimEvent, Tone, VarValue } from './types';

/**
 * Authoring helper for simulate(): a cursor over simulated time that appends events.
 * Sequential code reads top-down; parallel branches pass an explicit time with `at`.
 */
export class Recorder {
  readonly events: SimEvent[] = [];
  now = 0;

  at(t: number): this {
    this.now = t;
    return this;
  }

  wait(ms: number): this {
    this.now += ms;
    return this;
  }

  node(node: string, status: NodeStatus, badge?: string | null, t = this.now): this {
    this.events.push({ t, type: 'node', node, status, badge });
    return this;
  }

  /** A token travels along an edge; by default the cursor advances by its duration. */
  transit(edge: string, dur = 350, opts: { tone?: Tone; label?: string; advance?: boolean; t?: number } = {}): this {
    const t = opts.t ?? this.now;
    this.events.push({ t, type: 'transit', edge, dur, tone: opts.tone, label: opts.label });
    if (opts.advance !== false && opts.t === undefined) this.now += dur;
    return this;
  }

  log(text: string, tone: Tone = 'info', node?: string, t = this.now): this {
    this.events.push({ t, type: 'log', text, tone, node });
    return this;
  }

  count(key: string, delta = 1, t = this.now): this {
    this.events.push({ t, type: 'count', key, delta });
    return this;
  }

  set(key: string, value: VarValue, t = this.now): this {
    this.events.push({ t, type: 'set', key, value });
    return this;
  }

  /** Runs a node for `ms`: active → (status) with the cursor moved past it. */
  run(node: string, ms: number, done: NodeStatus = 'ok', badge?: string | null): this {
    this.node(node, 'active', badge);
    this.now += ms;
    this.node(node, done, badge);
    return this;
  }

  end(outcome: string, tone: Tone): SimEvent[] {
    this.events.push({ t: this.now, type: 'end', outcome, tone });
    return this.events;
  }
}
