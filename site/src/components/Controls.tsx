import { memo, useId } from 'react';
import type { Playback, Speed } from '../engine/playback';
import { fmt } from '../engine/format';
import type { Config, Param, PatternSim, Preset } from '../engine/types';

export function Transport({ pb, timeUnit, label = 'Playback' }: { pb: Playback; timeUnit: 'ms' | 'steps'; label?: string }) {
  const pct = pb.duration ? (pb.clock / pb.duration) * 100 : 0;
  return (
    <div className="transport" role="group" aria-label={label}>
      <div className="transport-buttons">
        <button type="button" className="btn icon primary" onClick={pb.toggle} aria-label={pb.playing ? 'Pause' : 'Play'} title={pb.playing ? 'Pause (space)' : 'Play (space)'}>
          {pb.playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>}
        </button>
        <button type="button" className="btn icon" onClick={pb.step} aria-label="Step forward" title="Step to the next event (→)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10l7-5zM11 3h2v10h-2z" /></svg>
        </button>
        <button type="button" className="btn icon" onClick={pb.reset} aria-label="Reset" title="Reset (R)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3a5 5 0 1 1-4.6 3H1.6A6.6 6.6 0 1 0 3.3 3.6L2 2.3V6h3.7L4.4 4.7A5 5 0 0 1 8 3z" /></svg>
        </button>
        <div className="speed" role="radiogroup" aria-label="Playback speed">
          {([0.5, 1, 2] as Speed[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={pb.speed === s} className={`chip ${pb.speed === s ? 'on' : ''}`} onClick={() => pb.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <label className="scrub">
        <span className="sr-only">Simulated time</span>
        <input type="range" min={0} max={Math.max(1, pb.duration)} step={1} value={pb.clock} onChange={(e) => pb.seek(Number(e.target.value))} style={{ ['--pct' as string]: `${pct}%` }} />
      </label>
      <output className="clock" aria-live="off">
        {timeUnit === 'ms' ? (<><span>t =</span> {fmt(pb.clock, 'ms')} <small>/ {fmt(pb.duration, 'ms')} simulated</small></>) : (<><span>step</span> {Math.round(pct)}%</>)}
      </output>
    </div>
  );
}

function ParamControl({ p, value, onChange, idPrefix }: { p: Param; value: Config[string]; onChange: (v: Config[string]) => void; idPrefix: string }) {
  const id = `${idPrefix}-${p.key}`;
  const help = [p.help, p.source].filter(Boolean).join(' · ');
  if (p.type === 'number') {
    const v = Number(value);
    const display = p.unit === 'ms' ? fmt(v, 'ms') : p.unit === '%' ? `${v}%` : p.unit === 's' ? `${v} s` : p.unit === 'units' ? fmt(v, 'units') : String(v);
    return (
      <div className="param">
        <div className="param-head">
          <label htmlFor={id}>{p.label}</label>
          <output htmlFor={id}>{display}</output>
        </div>
        <input id={id} type="range" min={p.min} max={p.max} step={p.step} value={v} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--pct' as string]: `${((v - p.min) / (p.max - p.min || 1)) * 100}%` }} aria-describedby={help ? `${id}-h` : undefined} />
        {help && <p className="param-help" id={`${id}-h`}>{help}</p>}
      </div>
    );
  }
  if (p.type === 'toggle') {
    return (
      <div className="param toggle">
        <label htmlFor={id} className="switch">
          <input id={id} type="checkbox" role="switch" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} aria-describedby={help ? `${id}-h` : undefined} />
          <span className="track" aria-hidden="true" />
          <span>{p.label}</span>
        </label>
        {help && <p className="param-help" id={`${id}-h`}>{help}</p>}
      </div>
    );
  }
  const current = p.options.find((o) => o.value === value);
  if (p.options.length <= 3 && p.options.every((o) => o.label.length < 26)) {
    return (
      <fieldset className="param seg">
        <legend>{p.label}</legend>
        <div className="segmented">
          {p.options.map((o) => (
            <label key={o.value} className={value === o.value ? 'on' : ''}>
              <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        {(current?.note || help) && <p className="param-help">{[current?.note, help].filter(Boolean).join(' · ')}</p>}
      </fieldset>
    );
  }
  return (
    <div className="param">
      <div className="param-head"><label htmlFor={id}>{p.label}</label></div>
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {(current?.note || help) && <p className="param-help">{[current?.note, help].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}

interface ParamPanelProps {
  sim: PatternSim;
  config: Config;
  seed: number;
  onChange: (c: Config) => void;
  onSeed: (s: number) => void;
  onNewSeed: () => void;
  title?: string;
  compact?: boolean;
}

function ParamPanelImpl({ sim, config, seed, onChange, onSeed, onNewSeed, title = 'Parameters', compact = false }: ParamPanelProps) {
  const uid = useId();
  const visible = sim.params.filter((p) => !p.visibleIf || p.visibleIf(config));
  return (
    <section className={`panel params ${compact ? 'compact' : ''}`} aria-label={title}>
      <h3 className="panel-title">{title}</h3>
      {visible.length === 0 && <p className="muted small">This pattern is driven by its scenarios below.</p>}
      {visible.map((p) => (
        <ParamControl key={p.key} p={p} value={config[p.key]} idPrefix={uid} onChange={(v) => onChange({ ...config, [p.key]: v })} />
      ))}
      {sim.stochastic && (
        <div className="param seed">
          <label htmlFor={`${uid}-seed`}>Seed</label>
          <input id={`${uid}-seed`} type="number" inputMode="numeric" min={0} value={seed} onChange={(e) => onSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          <button type="button" className="btn small" onClick={onNewSeed} title="Draw a new seed">New seed</button>
          <p className="param-help">Same seed, same random draws: a scenario replays exactly.</p>
        </div>
      )}
    </section>
  );
}
export const ParamPanel = memo(ParamPanelImpl);

export function PresetBar({ presets, activeId, onPick, kind }: { presets: Preset[]; activeId: string | null; onPick: (p: Preset) => void; kind: Preset['kind'] }) {
  const list = presets.filter((p) => p.kind === kind);
  if (!list.length) return null;
  return (
    <div className={`presets ${kind}`} role="group" aria-label={kind === 'failure' ? 'Failure scenarios' : 'Scenarios'}>
      <span className="presets-label">{kind === 'failure' ? 'Failure modes' : 'Scenarios'}</span>
      {list.map((p) => (
        <button key={p.id} type="button" className={`chip ${kind === 'failure' ? 'danger' : ''} ${activeId === p.id ? 'on' : ''}`} aria-pressed={activeId === p.id} title={p.description} onClick={() => onPick(p)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
