import { useEffect, useMemo, useRef, useState } from 'react';
import { layout, type Orientation } from '../engine/layout';
import { frameAt } from '../engine/trace';
import type { Graph, PatternSim, Run, Trace } from '../engine/types';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Left-to-right while it stays readable (≥ 62 % scale), otherwise top-to-bottom. */
export function useOrientation(graph: Graph, width: number): Orientation {
  return useMemo(() => {
    if (!width) return 'LR';
    const lr = layout(graph, 'LR');
    return width >= lr.width * 0.62 ? 'LR' : 'TD';
  }, [graph, width]);
}

/** Frame + metrics at the clock: metrics are derived from the history up to now, final once it ends. */
export function useFrame(sim: PatternSim, run: Run, clock: number) {
  const frame = useMemo(() => frameAt(run.trace, clock), [run.trace, clock]);
  const ended = clock >= run.trace.duration;
  const live = useMemo(() => {
    if (ended) return run.metrics;
    const partial: Trace = {
      events: run.trace.events.filter((e) => e.t <= clock),
      duration: Math.min(clock, run.trace.duration),
      outcome: frame.outcome,
      counters: frame.counters,
      vars: frame.vars,
    };
    return sim.derive(partial, run.config, run.seed);
  }, [ended, run, clock, frame, sim]);
  return { frame, ended, metrics: live };
}

export function isFormTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('input, select, textarea, button, a, [role="radio"], [role="switch"]');
}
