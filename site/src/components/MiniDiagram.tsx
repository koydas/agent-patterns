import { memo, useMemo } from 'react';
import { defaults } from '../engine/trace';
import type { Frame } from '../engine/trace';
import { layout } from '../engine/layout';
import type { PatternSim } from '../engine/types';

const EMPTY: Frame = { nodes: {}, transits: [], visited: new Set(), counters: {}, vars: {}, logIndex: -1, outcome: null, clock: 0 };

/** Card thumbnail: the pattern's real default graph, shapes and edges only, with an ambient CSS flow. */
function MiniDiagramImpl({ sim }: { sim: PatternSim }) {
  const geo = useMemo(() => layout(sim.graph(defaults(sim)), 'LR'), [sim]);
  return (
    <svg className="diagram mini ambient o-LR" viewBox={`0 0 ${Math.ceil(geo.width)} ${Math.ceil(geo.height)}`} aria-hidden="true" focusable="false">
      <g className="edges">
        {geo.edges.map((e) => (
          <g key={e.edge.id} className={`edge ${e.edge.dashed ? 'dashed' : ''}`}><path d={e.d} /></g>
        ))}
      </g>
      <g className="nodes">
        {Object.values(geo.nodes).map((b) => (
          <g key={b.node.id} className={`node k-${b.node.kind} ${b.node.kind === 'human' ? 's-waiting' : ''}`} transform={`translate(${b.x},${b.y})`}>
            <rect className="node-body" width={b.w} height={b.h} rx={b.node.kind === 'start' || b.node.kind === 'end' || b.node.kind === 'fail' ? b.h / 2 : 9} />
          </g>
        ))}
      </g>
    </svg>
  );
}
export const MiniDiagram = memo(MiniDiagramImpl);
export { EMPTY as EMPTY_FRAME };
