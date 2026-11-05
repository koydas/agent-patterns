import { useCallback, useEffect, useRef, useState } from 'react';
import { nextStop, samePrefix } from './trace';
import type { Trace } from './types';

export type Speed = 0.5 | 1 | 2;
const MAX_WALL_MS = 28_000;

/** Simulated ms per wall ms: the pattern's scale, raised when a run would play longer than MAX_WALL_MS. */
export function rateFor(traces: Trace[], timeScale = 1): number {
  const longest = Math.max(1, ...traces.map((t) => t.duration));
  return Math.max(timeScale, longest / MAX_WALL_MS);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface Playback {
  clock: number;
  playing: boolean;
  speed: Speed;
  ended: boolean;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  step: () => void;
  seek: (t: number) => void;
  setSpeed: (s: Speed) => void;
}

/**
 * One clock in simulated time shared by every trace passed in (Compare plays both on the same clock).
 * When the traces change, the clock is kept only if the visible history up to it is identical;
 * otherwise the run restarts, so a parameter change never produces an inconsistent state.
 */
export function usePlayback(traces: Trace[], timeScale = 1, autoplay = true): Playback {
  const duration = Math.max(0, ...traces.map((t) => t.duration));
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(() => autoplay && !prefersReducedMotion());
  const [speed, setSpeed] = useState<Speed>(1);
  const prev = useRef<Trace[]>(traces);
  const clockRef = useRef(0);
  clockRef.current = clock;

  // restart on a parameter change unless the past is unchanged
  useEffect(() => {
    const before = prev.current;
    prev.current = traces;
    if (before === traces) return;
    const keep = before.length === traces.length && traces.every((t, i) => samePrefix(before[i], t, clockRef.current));
    if (!keep) setClock(0);
  }, [traces]);

  const rate = rateFor(traces, timeScale);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); // a background tab must not jump to the end
      last = now;
      let reachedEnd = false;
      setClock((c) => {
        const next = Math.min(duration, c + dt * rate * speed);
        if (next >= duration) reachedEnd = true;
        return next;
      });
      if (reachedEnd) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, speed, duration]);

  const ended = clock >= duration && duration > 0;
  const play = useCallback(() => {
    if (clockRef.current >= duration) setClock(0);
    setPlaying(true);
  }, [duration]);
  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => {
    setPlaying(false);
    setClock(0);
  }, []);
  const step = useCallback(() => {
    setPlaying(false);
    setClock((c) => nextStop(prev.current, c));
  }, []);
  const seek = useCallback((t: number) => setClock(Math.max(0, Math.min(duration, t))), [duration]);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  return { clock, playing, speed, ended, duration, play, pause, toggle, reset, step, seek, setSpeed };
}
