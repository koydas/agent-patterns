import { useMemo } from 'react';
import { usePlayback } from '../engine/playback';
import { frameAt, logs, normalize, phaseAt, runSim } from '../engine/trace';
import type { Graph, SimEvent, Trace } from '../engine/types';
import { loopWithGuard } from '../patterns/loop-with-guard';
import { catalog } from '../content';
import { CATEGORY_LABEL } from '../content/types';
import { href } from '../router';
import { Diagram } from './Diagram';
import { Icon } from './Icons';
import { Stepper } from './Stepper';
import { useFrame, useOrientation, useWidth } from './hooks';

// A run that is rejected once, then approved: the loop is visible within three rounds.
const CONFIG = normalize(loopWithGuard, { maxRounds: 3, approval: 50, validity: 100, latency: 900 });
const SEED = 3;

// The mockup's condensed view of the same run: the full simulation drives it through an id remapping.
const VIEW: Graph = {
  nodes: [
    { id: 'coder', label: 'Coder', sub: 'writes the code', kind: 'agent', rank: 0, lane: 0.5 },
    { id: 'reviewer', label: 'Reviewer', sub: 'strict JSON verdict', kind: 'agent', rank: 1, lane: 0.5 },
    { id: 'verdict', label: 'APPROVED?', sub: 'round cap', kind: 'gate', rank: 2, lane: 0.5 },
    { id: 'done', label: 'Approved', sub: 'return result', kind: 'end', rank: 3, lane: 0 },
    { id: 'escalate', label: 'Escalation', sub: 'human review', kind: 'human', rank: 3, lane: 1 },
  ],
  edges: [
    { id: 'coder-reviewer', from: 'coder', to: 'reviewer' },
    { id: 'reviewer-verdict', from: 'reviewer', to: 'verdict' },
    { id: 'verdict-done', from: 'verdict', to: 'done', label: 'yes' },
    { id: 'verdict-escalate', from: 'verdict', to: 'escalate', label: 'cap' },
    { id: 'verdict-coder', from: 'verdict', to: 'coder', side: 'near', label: 'loops back with the reasons', depth: 10 },
  ],
  rankGap: 180,
};
const NODE: Record<string, string | null> = { task: null, parse: 'reviewer', repair: 'reviewer', cap: null };
const EDGE: Record<string, string | null> = {
  'parse-verdict': 'reviewer-verdict', 'cap-coder': 'verdict-coder', 'cap-escalate': 'verdict-escalate', 'parse-escalate': 'verdict-escalate',
  'coder-escalate': 'verdict-escalate', 'task-coder': null, 'reviewer-parse': null, 'parse-repair': null, 'repair-reviewer': null, 'verdict-cap': null,
};
/** The same history with node and edge ids mapped onto the condensed view (order preserved). */
function remap(trace: Trace): Trace {
  const events: SimEvent[] = [];
  for (const e of trace.events) {
    if (e.type === 'node') { const to = e.node in NODE ? NODE[e.node] : e.node; if (to) events.push({ ...e, node: to }); }
    else if (e.type === 'transit') { const to = e.edge in EDGE ? EDGE[e.edge] : e.edge; if (to) events.push({ ...e, edge: to }); }
    else events.push(e);
  }
  return { ...trace, events };
}

/** Home: loop-with-guard step by step, on the same engine and simulation as its pattern page. */
export function Featured() {
  const run = useMemo(() => runSim(loopWithGuard, CONFIG, SEED), []);
  const viewTrace = useMemo(() => remap(run.trace), [run.trace]);
  const traces = useMemo(() => [run.trace], [run.trace]);
  const pb = usePlayback(traces, loopWithGuard.timeScale, false);
  const { frame } = useFrame(loopWithGuard, run, pb.clock);
  const [ref, width] = useWidth<HTMLDivElement>();
  const orientation = useOrientation(VIEW, width);

  const phase = phaseAt(loopWithGuard.phases, run.trace, pb.clock);
  const phases = loopWithGuard.phases ?? [];
  const entry = catalog.find((p) => p.slug === 'loop-with-guard')!;
  const round = Number(frame.vars.round ?? 0);

  return (
    <section className="section featured" aria-labelledby="featured-title">
      <div className="wrap">
        <div className="featured-card card glow">
          <div className="featured-text">
            <span className="tag star"><Icon name="star" size={12} /> Featured pattern</span>
            <h2 id="featured-title">loop-with-guard</h2>
            <p>
              A coder and a reviewer iterate until the reviewer approves — with a round cap, strict verdict parsing
              and an escalation path. If the verdict is malformed it is repaired on the reviewer side; if the cap is
              reached, a human gets the last reasons.
            </p>
            <div className="p-meta">
              <span className={`pill cat-${entry.category}`}>{CATEGORY_LABEL[entry.category]}</span>
              <span className="pill">Loop</span>
              <span className="pill"><Icon name="check" size={12} /> Guard</span>
            </div>
            <a className="more" href={href.pattern('loop-with-guard')}>Open the full playground <Icon name="arrow" size={15} /></a>
          </div>
          <div className="featured-sim" ref={ref}>
            <div className="featured-head">
              <span><Icon name="play" size={11} /> Step by step: loop-with-guard</span>
              <span className="tag">Step {Math.max(1, phase + 1)} / {phases.length}</span>
            </div>
            <Stepper phases={phases} current={phase} />
            <Diagram graph={VIEW} frame={frameAt(viewTrace, pb.clock)} orientation={orientation} label="loop-with-guard walkthrough: coder, reviewer, verdict, approved or escalation" />
            <div className="featured-controls">
              <button type="button" className="btn small primary" onClick={pb.play} disabled={pb.playing}><Icon name="play" size={12} /> Play</button>
              <button type="button" className="btn small" onClick={pb.pause} disabled={!pb.playing}>Pause</button>
              <button type="button" className="btn small" onClick={pb.step}>Next step <Icon name="arrow" size={13} /></button>
              <button type="button" className="btn small" onClick={pb.reset}>Reset</button>
              <span className="iter">Iteration {Math.max(1, round)} / {CONFIG.maxRounds}
                <span className="dots" aria-hidden="true">{Array.from({ length: Number(CONFIG.maxRounds) }, (_, i) => <i key={i} className={i < round ? 'on' : ''} />)}</span>
              </span>
            </div>
            <p className="featured-caption" aria-live="polite">{frame.outcome?.label ?? (pb.clock > 0 ? logs(run.trace)[frame.logIndex]?.text : 'Press Play or Next step.')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
