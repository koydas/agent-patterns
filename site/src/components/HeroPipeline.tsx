import { useEffect, useMemo, useState } from 'react';
import { usePlayback } from '../engine/playback';
import { runSim } from '../engine/trace';
import { composite } from '../patterns/composite';
import { logs } from '../engine/trace';
import { href } from '../router';
import { Diagram } from './Diagram';
import { StatePanel } from './StatePanel';
import { useFrame, useOrientation, useWidth } from './hooks';

const SCENARIOS = composite.params[0].type === 'select' ? composite.params[0].options : [];
const LINKS: Record<string, string> = { validator: 'validator-first', review: 'tool-grounded-review', fix: 'loop-with-guard', human: 'human-gate' };

/** The autonomous-dev-loop pipeline, played by the same engine as the pattern pages. Loops through scenarios. */
export function HeroPipeline() {
  const [i, setI] = useState(1);
  const scenario = SCENARIOS[i].value;
  const run = useMemo(() => runSim(composite, { scenario }, 0), [scenario]);
  const traces = useMemo(() => [run.trace], [run.trace]);
  const pb = usePlayback(traces, 1);
  const { frame, ended } = useFrame(composite, run, pb.clock);
  const graph = useMemo(() => composite.graph({}), []);
  const [ref, width] = useWidth<HTMLDivElement>();
  const orientation = useOrientation(graph, width);
  const [auto, setAuto] = useState(true);

  // after a run ends, hold the outcome, then play the next scenario
  useEffect(() => {
    if (!ended || !auto) return;
    const t = setTimeout(() => { setI((x) => (x + 1) % SCENARIOS.length); pb.play(); }, 2600);
    return () => clearTimeout(t);
  }, [ended, auto, pb]);

  const entries = logs(run.trace);
  const current = entries[frame.logIndex];
  const linked = current?.node && LINKS[current.node];

  return (
    <div className="hero-visual card glow" ref={ref}>
      <div className="hero-visual-head">
        <h2>autonomous-dev-loop — five patterns, one pipeline</h2>
        {frame.outcome && <span className={`outcome tone-${frame.outcome.tone}`} role="status">{frame.outcome.label}</span>}
      </div>
      <Diagram graph={graph} frame={frame} orientation={orientation} label="autonomous-dev-loop pipeline: issue, validator-first, code generation, tool-grounded review, loop-with-guard auto-fix, human gate" />
      <p className="hero-caption" aria-live="polite">
        {current ? current.text : 'An issue enters the loop.'}
        {linked && <> — <a href={href.pattern(linked)}>{linked}</a></>}
      </p>
      <StatePanel sim={composite} vars={frame.vars} />
      <div className="presets" role="group" aria-label="Pipeline scenario">
        {SCENARIOS.map((s, k) => (
          <button key={s.value} type="button" className={`chip ${k === i ? 'on' : ''}`} aria-pressed={k === i} onClick={() => { setAuto(false); setI(k); pb.play(); }}>{s.label}</button>
        ))}
        <button type="button" className="chip" onClick={pb.toggle} aria-label={pb.playing ? 'Pause' : 'Play'}>{pb.playing ? 'Pause' : 'Play'}</button>
      </div>
    </div>
  );
}
