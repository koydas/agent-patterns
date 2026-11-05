import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlayback } from '../engine/playback';
import { newSeed } from '../engine/rng';
import { normalize, runSim } from '../engine/trace';
import { toSearch } from '../engine/url';
import type { Config, PatternSim, Preset } from '../engine/types';
import { Diagram } from './Diagram';
import { ParamPanel, PresetBar, Transport } from './Controls';
import { Explain, Metrics, Timeline } from './Panels';
import { StatePanel } from './StatePanel';
import { isFormTarget, useFrame, useOrientation, useWidth } from './hooks';

interface PlaygroundProps {
  sim: PatternSim;
  title: string;
  initialConfig: Config;
  initialSeed: number;
  onUrl?: (search: string) => void;
}

export function Playground({ sim, title, initialConfig, initialSeed, onUrl }: PlaygroundProps) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [seed, setSeed] = useState(initialSeed);
  const [presetId, setPresetId] = useState<string | null>(null);
  const run = useMemo(() => runSim(sim, config, seed), [sim, config, seed]);
  const traces = useMemo(() => [run.trace], [run.trace]);
  const pb = usePlayback(traces, sim.timeScale);
  const { frame, ended, metrics } = useFrame(sim, run, pb.clock);
  const graph = useMemo(() => sim.graph(config), [sim, config]);
  const [stageRef, width] = useWidth<HTMLDivElement>();
  const orientation = useOrientation(graph, width);
  const explain = useMemo(() => (ended ? sim.explain(run.trace, config, seed) : []), [ended, sim, run.trace, config, seed]);

  useEffect(() => onUrl?.(toSearch(sim, { mode: 'explore', config, seed })), [sim, config, seed, onUrl]);

  const change = useCallback((c: Config) => { setConfig(c); setPresetId(null); }, []);
  const pick = useCallback((p: Preset) => {
    setConfig(normalize(sim, p.config));
    if (p.seed !== undefined) setSeed(p.seed);
    setPresetId(p.id);
    pb.play();
  }, [sim, pb]);

  const onKey = (e: React.KeyboardEvent) => {
    if (isFormTarget(e.target)) return;
    if (e.key === ' ') { e.preventDefault(); pb.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pb.step(); }
    else if (e.key === 'r' || e.key === 'R') pb.reset();
  };

  return (
    <div className="playground" onKeyDown={onKey}>
      <div className="stage-col">
        <div className="stage card glow" ref={stageRef} tabIndex={0} aria-label={`${title} simulation. Space: play or pause, right arrow: step, R: reset.`}>
          <div className="stage-head">
            <p className="invariant"><span className="tag inv">invariant</span>{sim.invariant}</p>
            {frame.outcome && <span className={`outcome tone-${frame.outcome.tone}`} role="status">{frame.outcome.label}</span>}
          </div>
          <Diagram graph={graph} frame={frame} orientation={orientation} label={`${title} diagram`} />
        </div>
        <Transport pb={pb} timeUnit={sim.timeUnit} />
        <div className="preset-rows">
          <PresetBar presets={sim.presets} kind="scenario" activeId={presetId} onPick={pick} />
          <PresetBar presets={sim.presets} kind="failure" activeId={presetId} onPick={pick} />
        </div>
      </div>
      <div className="side-col">
        <ParamPanel sim={sim} config={config} seed={seed} onChange={change} onSeed={setSeed} onNewSeed={() => setSeed(newSeed())} />
      </div>
      <div className="info-col">
        <Metrics specs={sim.metrics} values={metrics} ended={ended} outcome={frame.outcome} />
        <StatePanel sim={sim} vars={frame.vars} />
        <Timeline trace={run.trace} index={frame.logIndex} timeUnit={sim.timeUnit} />
      </div>
      <div className="explain-col">
        {ended ? <Explain lines={explain} /> : <p className="muted small hint">Play the run to the end for an explanation derived from its event history — or press Step to walk it event by event.</p>}
      </div>
    </div>
  );
}
