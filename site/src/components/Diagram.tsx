import { memo, useMemo } from 'react';
import { bezier, layout, type Geometry, type NodeBox, type Orientation } from '../engine/layout';
import type { Frame } from '../engine/trace';
import type { Graph, NodeStatus } from '../engine/types';
import { iconPath } from './Icons';

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: '', active: 'running', waiting: 'waiting', ok: 'done', fail: 'failed', blocked: 'blocked', skipped: 'skipped', warn: 'warning',
};

function Glyph({ status, x, y }: { status: NodeStatus; x: number; y: number }) {
  if (status === 'idle' || status === 'active') return null;
  const path: Partial<Record<NodeStatus, string>> = {
    ok: 'M-3.2,0.2 L-0.9,2.5 L3.4,-2.4',
    fail: 'M-2.6,-2.6 L2.6,2.6 M2.6,-2.6 L-2.6,2.6',
    blocked: 'M-3,0 L3,0',
    warn: 'M0,-3 L0,0.8 M0,2.6 L0,2.7',
    skipped: 'M-3,0 L3,0',
    waiting: 'M0,-2.8 L0,0 L2,1.6',
  };
  return (
    <g className={`glyph g-${status}`} transform={`translate(${x},${y})`} aria-hidden="true">
      <circle r="7" />
      <path d={path[status]} />
    </g>
  );
}

function NodeShape({ box, compact }: { box: NodeBox; compact: boolean }) {
  const { node, w, h } = box;
  const rx = node.kind === 'start' || node.kind === 'end' || node.kind === 'fail' ? h / 2 : node.kind === 'gate' ? 6 : 10;
  if (node.kind === 'store') {
    const e = 6;
    return (
      <>
        <path className="node-body" d={`M0,${e} C0,${-e / 2} ${w},${-e / 2} ${w},${e} L${w},${h - e} C${w},${h + e / 2} 0,${h + e / 2} 0,${h - e} Z`} />
        <path className="node-rim" d={`M0,${e} C0,${e * 2.2} ${w},${e * 2.2} ${w},${e}`} />
      </>
    );
  }
  return (
    <>
      <rect className="node-body" width={w} height={h} rx={rx} />
      {node.kind === 'gate' && !compact && node.size !== 'sm' && <path className="node-mark" d={`M10,${h / 2} l5,-5 l5,5 l-5,5 z`} />}
      {node.kind === 'human' && node.size !== 'sm' && !compact && (
        <g className="node-mark" transform={`translate(15,${h / 2})`}>
          <circle cy="-4" r="3" />
          <path d="M-5,6 C-5,0 5,0 5,6" />
        </g>
      )}
    </>
  );
}

interface DiagramProps {
  graph: Graph;
  frame: Frame;
  orientation: Orientation;
  label: string;
  /** Hides second lines and edge labels: card thumbnails. */
  mini?: boolean;
}

function DiagramImpl({ graph, frame, orientation, label, mini = false }: DiagramProps) {
  const geo: Geometry = useMemo(() => layout(graph, orientation), [graph, orientation]);
  const compact = mini || orientation === 'TD';
  const active = new Set(frame.transits.map((t) => t.edge));
  const runningNodes = Object.entries(frame.nodes).filter(([, s]) => s.status === 'active').map(([id]) => geo.nodes[id]?.node.label).filter(Boolean);
  const aria = `${label}. ${runningNodes.length ? `Running: ${runningNodes.join(', ')}.` : ''} ${frame.outcome ? `Outcome: ${frame.outcome.label}.` : ''}`;

  return (
    <svg
      className={`diagram ${mini ? 'mini' : ''} o-${orientation}`}
      viewBox={`0 0 ${Math.ceil(geo.width)} ${Math.ceil(geo.height)}`}
      role="img"
      aria-label={aria}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${Math.ceil(geo.width)} / ${Math.ceil(geo.height)}` }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" className="arrowhead" />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" className="arrowhead active" />
        </marker>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g className="edges">
        {geo.edges.map((e) => {
          const on = active.has(e.edge.id);
          const cls = `edge ${on ? 'active' : ''} ${frame.visited.has(e.edge.id) ? 'visited' : ''} ${e.edge.dashed ? 'dashed' : ''}`;
          return (
            <g key={e.edge.id} className={cls}>
              <path d={e.d} markerEnd={`url(#${on ? 'arrow-active' : 'arrow'})`} />
              {on && !mini && <path className="edge-flow" d={e.d} />}
            </g>
          );
        })}
      </g>
      {!mini && (
        <g className="edge-labels" aria-hidden="true">
          {geo.edges.filter((e) => e.edge.label).map((e) => {
            const text = e.edge.label!;
            const w = text.length * 5.6 + 10;
            return (
              <g key={e.edge.id} transform={`translate(${e.label.x},${e.label.y})`} className={`edge-label ${active.has(e.edge.id) ? 'active' : ''}`}>
                <rect x={-w / 2} y={-8} width={w} height={16} rx={8} />
                <text y={3.5}>{text}</text>
              </g>
            );
          })}
        </g>
      )}
      <g className="nodes">
        {Object.values(geo.nodes).map((box) => {
          const st = frame.nodes[box.node.id];
          const status = st?.status ?? 'idle';
          const sm = box.node.size === 'sm';
          const showSub = !compact && !!box.node.sub && !sm;
          const textX = box.node.kind === 'gate' || box.node.kind === 'human' ? (compact || sm ? box.w / 2 : box.w / 2 + 8) : box.w / 2;
          if (box.node.size === 'tile' || box.node.size === 'icon') {
            const tile = box.node.size === 'tile';
            const lines = box.node.label.split('\n');
            return (
              <g key={box.node.id} className={`node tile k-${box.node.kind} s-${status} ${box.node.tone ? `tn-${box.node.tone}` : ''}`} transform={`translate(${box.x},${box.y})`}>
                <title>{box.node.label.replace('\n', ' ')}{STATUS_TEXT[status] ? `: ${STATUS_TEXT[status]}` : ''}</title>
                <rect className="node-body" width={box.w} height={box.h} rx={tile ? 14 : 10} />
                <g className="tile-icon" transform={tile ? `translate(${box.w / 2 - 11},${lines.length > 2 ? 9 : 13}) scale(0.92)` : `translate(${box.w / 2 - 10},${box.h / 2 - 10}) scale(0.84)`}>
                  <path d={iconPath(box.node.icon ?? 'file')} />
                </g>
                {tile && lines.map((l, i) => <text key={i} className="node-label tile-label" x={box.w / 2} y={(lines.length > 2 ? 46 : 50) + i * 13}>{l}</text>)}
                {!mini && tile && <Glyph status={status} x={box.w - 2} y={2} />}
              </g>
            );
          }
          return (
            <g key={box.node.id} className={`node k-${box.node.kind} s-${status} ${sm ? 'sm' : ''} ${box.node.tone ? `tn-${box.node.tone}` : ''}`} transform={`translate(${box.x},${box.y})`}>
              <title>{`${box.node.label}${box.node.sub ? ` — ${box.node.sub}` : ''}${STATUS_TEXT[status] ? `: ${STATUS_TEXT[status]}` : ''}${st?.badge ? ` (${st.badge})` : ''}`}</title>
              <NodeShape box={box} compact={compact} />
              <text className="node-label" x={textX} y={showSub ? box.h / 2 - 2 : box.h / 2 + 4}>{box.node.label}</text>
              {showSub && <text className="node-sub" x={textX} y={box.h / 2 + 12}>{box.node.sub}</text>}
              {!mini && <Glyph status={status} x={box.w - 2} y={2} />}
              {!mini && st?.badge && (
                <g className="badge" transform={`translate(${box.w / 2},${box.h + 9})`}>
                  <rect x={-(st.badge.length * 2.9 + 7)} y={-7} width={st.badge.length * 5.8 + 14} height={14} rx={7} />
                  <text y={3}>{st.badge}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>
      <g className="tokens" aria-hidden="true">
        {frame.transits.map((t, i) => {
          const e = geo.edges.find((g) => g.edge.id === t.edge);
          if (!e) return null;
          const p = bezier(e.pts, Math.max(0, Math.min(1, t.p)));
          return (
            <g key={`${t.edge}-${i}`} className={`token t-${t.tone ?? 'accent'}`} transform={`translate(${p.x},${p.y})`}>
              <circle r={mini ? 4 : 6} filter="url(#glow)" />
              {t.label && !mini && <text y={-10}>{t.label}</text>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export const Diagram = memo(DiagramImpl);
