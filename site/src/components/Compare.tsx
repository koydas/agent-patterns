import { useCallback, useEffect, useMemo, useState } from 'react';
import { deltas, fmt } from '../engine/format';
import { usePlayback } from '../engine/playback';
import { newSeed } from '../engine/rng';
import { normalize, runSim } from '../engine/trace';
import { toSearch } from '../engine/url';
import type { ComparePreset, Config, PatternSim, Run } from '../engine/types';
import type { Frame } from '../engine/trace';
import { Diagram } from './Diagram';
import { ParamPanel, Transport } from './Controls';
import { Explain, Timeline } from './Panels';
import { isFormTarget, useFrame, useOrientation, useWidth } from './hooks';

interface CompareProps {
  sim: PatternSim;
  title: string;
  initial: { a: Config; b: Config; seedA: number; seedB: number };
  /** Opens on this comparison when the URL carries no scenario. */
  initialPreset?: ComparePreset;
  onUrl?: (search: string) => void;
}

function Side({ sim, run, frame, name, label }: { sim: PatternSim; run: Run; frame: Frame; name: 'A' | 'B'; label: string }) {
  const graph = useMemo(() => sim.graph(run.config), [sim, run.config]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const orientation = useOrientation(graph, width);
  return (
    <div className="cmp-side">
      <div className="stage card" ref={ref}>
        <div className="stage-head">
          <p className="scenario-name"><span className={`tag scen scen-${name}`}>Scenario {name}</span>{label}</p>
          {frame.outcome && <span className={`outcome tone-${frame.outcome.tone}`}>{frame.outcome.label}</span>}
        </div>
        <Diagram graph={graph} frame={frame} orientation={orientation} label={`Scenario ${name} diagram`} />
      </div>
      <Timeline trace={run.trace} index={frame.logIndex} timeUnit={sim.timeUnit} compact />
    </div>
  );
}

export function Compare({ sim, title, initial, initialPreset, onUrl }: CompareProps) {
  const p0 = initialPreset;
  const [a, setA] = useState(() => (p0 ? normalize(sim, p0.a.config) : initial.a));
  const [b, setB] = useState(() => (p0 ? normalize(sim, p0.b.config) : initial.b));
  const [seedA, setSeedA] = useState(p0?.seed ?? initial.seedA);
  const [seedB, setSeedB] = useState(p0?.seed ?? initial.seedB);
  const [shared, setShared] = useState(p0 ? true : initial.seedA === initial.seedB);
  const [labels, setLabels] = useState(p0 ? { a: p0.a.label, b: p0.b.label } : { a: 'Scenario A', b: 'Scenario B' });
  const [preset, setPreset] = useState<ComparePreset | null>(p0 ?? null);

  const runA = useMemo(() => runSim(sim, a, seedA), [sim, a, seedA]);
  const runB = useMemo(() => runSim(sim, b, shared ? seedA : seedB), [sim, b, seedA, seedB, shared]);
  const traces = useMemo(() => [runA.trace, runB.trace], [runA.trace, runB.trace]);
  const pb = usePlayback(traces, sim.timeScale);
  const fa = useFrame(sim, runA, pb.clock);
  const fb = useFrame(sim, runB, pb.clock);
  const bothEnded = fa.ended && fb.ended;

  useEffect(() => onUrl?.(toSearch(sim, { mode: 'compare', a, b, seedA, seedB: shared ? seedA : seedB })), [sim, a, b, seedA, seedB, shared, onUrl]);

  const applyPreset = useCallback((p: ComparePreset) => {
    setA(normalize(sim, p.a.config));
    setB(normalize(sim, p.b.config));
    const s = p.seed ?? seedA;
    setSeedA(s); setSeedB(s); setShared(true);
    setLabels({ a: p.a.label, b: p.b.label });
    setPreset(p);
    pb.play();
  }, [sim, seedA, pb]);

  const edited = () => { setPreset(null); setLabels({ a: 'Scenario A', b: 'Scenario B' }); };
  const copyAtoB = () => { setB({ ...a }); setSeedB(seedA); edited(); };
  const swap = () => { setA(b); setB(a); setLabels((l) => ({ a: l.b, b: l.a })); };
  const rows = deltas(sim.metrics, { ...runA, metrics: fa.metrics }, { ...runB, metrics: fb.metrics });
  const explanation = useMemo(() => (bothEnded && sim.compare ? sim.compare(runA, runB) : []), [bothEnded, sim, runA, runB]);

  const onKey = (e: React.KeyboardEvent) => {
    if (isFormTarget(e.target)) return;
    if (e.key === ' ') { e.preventDefault(); pb.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pb.step(); }
    else if (e.key === 'r' || e.key === 'R') pb.reset();
  };

  return (
    <div className="compare" onKeyDown={onKey} tabIndex={-1} aria-label={`${title}: compare two scenarios`}>
      {sim.comparePresets.length > 0 && (
        <div className="presets cmp" role="group" aria-label="Comparison presets">
          <span className="presets-label">Comparisons</span>
          {sim.comparePresets.map((p) => (
            <button key={p.id} type="button" className={`chip ${preset?.id === p.id ? 'on' : ''}`} aria-pressed={preset?.id === p.id} title={p.description} onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
      )}
      {preset && <p className="cmp-desc">{preset.description}{preset.caveat && <strong className="caveat"> {preset.caveat}</strong>}</p>}
      <div className="cmp-transport">
        <Transport pb={pb} timeUnit={sim.timeUnit} label="Synchronized playback (both scenarios share one simulated clock)" />
        {sim.stochastic && (
          <label className="switch small">
            <input type="checkbox" role="switch" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span className="track" aria-hidden="true" />
            <span>Same seed for A and B <small className="muted">(common random numbers — isolates the configuration change)</small></span>
          </label>
        )}
      </div>
      <div className="cmp-grid">
        <Side sim={sim} run={runA} frame={fa.frame} name="A" label={labels.a} />
        <Side sim={sim} run={runB} frame={fb.frame} name="B" label={labels.b} />
      </div>

      <section className="panel cmp-table" aria-label="Comparative metrics">
        <h3 className="panel-title">Comparison <span className="tag sim">simulated</span> <span className="tag">{bothEnded ? 'final' : 'live'}</span></h3>
        <table>
          <thead><tr><th scope="col">Metric</th><th scope="col">A</th><th scope="col">B</th></tr></thead>
          <tbody>
            {sim.metrics.map((s, i) => {
              const d = rows[i];
              const mark = (side: 'a' | 'b') => (d.better === side ? <span className="better" aria-label="better"> ▲ better</span> : null);
              return (
                <tr key={s.key} className={d.a !== d.b ? 'diff' : ''}>
                  <th scope="row">{s.label}{s.estimate && <span className="tag est">theoretical</span>}</th>
                  <td>{fmt(d.a, s.format)}{mark('a')}</td>
                  <td>{fmt(d.b, s.format)}{mark('b')}{d.a !== d.b && d.better === null && <span className="changed" aria-label="differs"> ≠</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {bothEnded ? <Explain lines={explanation} title="Observed trade-off" /> : <p className="muted small hint">The explanation appears when both runs have finished.</p>}

      <div className="cmp-params">
        <ParamPanel sim={sim} config={a} seed={seedA} title="Scenario A parameters" compact onChange={(c) => { setA(c); edited(); }} onSeed={setSeedA} onNewSeed={() => setSeedA(newSeed())} />
        <div className="cmp-actions">
          <button type="button" className="btn" onClick={copyAtoB}>Copy A → B</button>
          <button type="button" className="btn" onClick={swap}>Swap A ↔ B</button>
        </div>
        <ParamPanel sim={sim} config={b} seed={shared ? seedA : seedB} title="Scenario B parameters" compact onChange={(c) => { setB(c); edited(); }} onSeed={(s) => { setShared(false); setSeedB(s); }} onNewSeed={() => { setShared(false); setSeedB(newSeed()); }} />
      </div>
    </div>
  );
}
