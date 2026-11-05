import { memo, useEffect, useRef } from 'react';
import { fmt } from '../engine/format';
import { logs, type Frame } from '../engine/trace';
import type { MetricSpec, Trace } from '../engine/types';

function TimelineImpl({ trace, index, timeUnit, compact = false }: { trace: Trace; index: number; timeUnit: 'ms' | 'steps'; compact?: boolean }) {
  const entries = logs(trace);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[data-current="true"]');
    const box = list.current;
    if (el && box) box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight + el.clientHeight + 8);
  }, [index]);
  return (
    <section className={`panel timeline ${compact ? 'compact' : ''}`} aria-label="Execution timeline">
      <h3 className="panel-title">Event log <small>{index + 1}/{entries.length}</small></h3>
      <ol ref={list}>
        {entries.map((e, i) => (
          <li key={i} className={`tone-${e.tone ?? 'info'} ${i > index ? 'future' : ''}`} data-current={i === index} aria-current={i === index ? 'step' : undefined}>
            {timeUnit === 'ms' && <time>{fmt(e.t, 'ms')}</time>}
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">{index >= 0 ? entries[index]?.text : ''}</p>
    </section>
  );
}
export const Timeline = memo(TimelineImpl);

function MetricsImpl({ specs, values, ended, outcome }: { specs: MetricSpec[]; values: Record<string, number | string>; ended: boolean; outcome: Frame['outcome'] }) {
  return (
    <section className="panel metrics" aria-label="Simulated metrics">
      <h3 className="panel-title">
        Metrics <span className="tag sim">simulated</span>
        {outcome && <span className={`tag tone-${outcome.tone}`}>{ended ? 'final' : 'live'}</span>}
      </h3>
      <dl>
        {specs.map((s) => (
          <div key={s.key} className={`metric ${s.format === 'text' ? 'wide' : ''} ${s.estimate ? 'estimate' : ''}`} title={s.hint}>
            <dt>{s.label}{s.estimate && <span className="tag est">theoretical</span>}</dt>
            <dd className={s.format === 'text' && outcome && s.key === 'outcome' ? `tone-${outcome.tone}` : ''}>{fmt(values[s.key], s.format)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
export const Metrics = memo(MetricsImpl);

export function Explain({ lines, title = 'What happened' }: { lines: string[]; title?: string }) {
  if (!lines.length) return null;
  return (
    <section className="panel explain" aria-label={title}>
      <h3 className="panel-title">{title} <span className="tag sim">derived from the event history</span></h3>
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </section>
  );
}
