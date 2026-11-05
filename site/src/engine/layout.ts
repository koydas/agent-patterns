import type { Graph, GraphEdge, GraphNode } from './types';

// Rank/lane grid → coordinates. The same graph renders left-to-right on wide screens and top-to-bottom on
// phones, so no diagram is ever shrunk below a readable size. Edges are cubic Béziers computed here, so a
// token's position on an edge is analytic (no DOM measurement, testable).

export type Orientation = 'LR' | 'TD';
export interface Pt {
  x: number;
  y: number;
}
export interface NodeBox {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface EdgeGeo {
  edge: GraphEdge;
  pts: [Pt, Pt, Pt, Pt];
  d: string;
  label: Pt;
}
export interface Geometry {
  orientation: Orientation;
  nodes: Record<string, NodeBox>;
  edges: EdgeGeo[];
  width: number;
  height: number;
}

const SIZE = {
  LR: { md: { w: 124, h: 46 }, sm: { w: 46, h: 34 }, tile: { w: 98, h: 84 }, icon: { w: 40, h: 40 }, rank: 160, lane: 74 },
  TD: { md: { w: 114, h: 40 }, sm: { w: 40, h: 32 }, tile: { w: 98, h: 84 }, icon: { w: 40, h: 40 }, rank: 74, lane: 128 },
} as const;
const PAD = 22;

export function bezier([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function layout(graph: Graph, orientation: Orientation, opts: { rankGap?: number; laneGap?: number } = {}): Geometry {
  const S = SIZE[orientation];
  const rankGap = opts.rankGap ?? (orientation === 'LR' ? graph.rankGap : undefined) ?? S.rank;
  const laneGap = opts.laneGap ?? S.lane;
  const minLane = Math.min(...graph.nodes.map((n) => n.lane));
  const raw: Record<string, NodeBox> = {};
  for (const node of graph.nodes) {
    const { w, h } = S[node.size ?? 'md'];
    const main = node.rank * rankGap;
    const cross = (node.lane - minLane) * laneGap;
    const cx = orientation === 'LR' ? main : cross;
    const cy = orientation === 'LR' ? cross : main;
    raw[node.id] = { node, x: cx - w / 2, y: cy - h / 2, w, h };
  }
  const edges0 = graph.edges.map((edge) => edgeGeo(edge, raw, orientation));
  // bounds, including loop control points (a cubic stays inside its control hull)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of Object.values(raw)) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  for (const e of edges0) for (const p of [bezier(e.pts, 0.25), bezier(e.pts, 0.5), bezier(e.pts, 0.75)]) {
    minX = Math.min(minX, p.x - 8); minY = Math.min(minY, p.y - 8);
    maxX = Math.max(maxX, p.x + 8); maxY = Math.max(maxY, p.y + 8);
  }
  const dx = PAD - minX, dy = PAD - minY;
  const nodes: Record<string, NodeBox> = {};
  for (const [id, b] of Object.entries(raw)) nodes[id] = { ...b, x: b.x + dx, y: b.y + dy };
  const edges = edges0.map((e) => {
    const pts = e.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) as [Pt, Pt, Pt, Pt];
    return { edge: e.edge, pts, d: pathOf(pts), label: { x: e.label.x + dx, y: e.label.y + dy } };
  });
  return { orientation, nodes, edges, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD };
}

const pathOf = ([a, b, c, d]: Pt[]) =>
  `M${r(a.x)},${r(a.y)} C${r(b.x)},${r(b.y)} ${r(c.x)},${r(c.y)} ${r(d.x)},${r(d.y)}`;
const r = (n: number) => Math.round(n * 10) / 10;

function edgeGeo(edge: GraphEdge, boxes: Record<string, NodeBox>, o: Orientation): Omit<EdgeGeo, 'd'> {
  const A = boxes[edge.from];
  const B = boxes[edge.to];
  if (!A || !B) throw new Error(`edge ${edge.id}: unknown node ${!A ? edge.from : edge.to}`);
  // work in (main, cross) space then map back
  const m = (b: NodeBox) => (o === 'LR' ? { main: b.x, cross: b.y, ml: b.w, cl: b.h } : { main: b.y, cross: b.x, ml: b.h, cl: b.w });
  const toPt = (main: number, cross: number): Pt => (o === 'LR' ? { x: main, y: cross } : { x: cross, y: main });
  const a = m(A), b = m(B);
  const aMid = a.cross + a.cl / 2, bMid = b.cross + b.cl / 2;
  const sameRank = A.node.rank === B.node.rank;
  const forward = B.node.rank > A.node.rank;
  const sign = edge.side === 'far' ? -1 : 1; // near = below (LR) / right (TD)

  if (edge.from === edge.to) {
    const c0 = sign > 0 ? a.cross + a.cl : a.cross;
    const depth = 34 + (edge.depth ?? 0);
    const p0 = toPt(a.main + a.ml * 0.7, c0), p3 = toPt(a.main + a.ml * 0.3, c0);
    const p1 = toPt(a.main + a.ml * 0.95, c0 + sign * depth), p2 = toPt(a.main + a.ml * 0.05, c0 + sign * depth);
    return { edge, pts: [p0, p1, p2, p3], label: toPt(a.main + a.ml / 2, c0 + sign * (depth * 0.78)) };
  }
  if (forward && !edge.side) {
    const p0 = toPt(a.main + a.ml, aMid), p3 = toPt(b.main, bMid);
    const k = Math.max(24, (b.main - (a.main + a.ml)) / 2);
    const pts: [Pt, Pt, Pt, Pt] = [p0, toPt(a.main + a.ml + k, aMid), toPt(b.main - k, bMid), p3];
    return { edge, pts, label: bezier(pts, 0.5) };
  }
  if (sameRank && !edge.side) {
    const down = bMid > aMid;
    const s = edge.shift ?? 0;
    const am = a.main + a.ml / 2 + s, bm = b.main + b.ml / 2 + s;
    const ca = down ? a.cross + a.cl : a.cross, cb = down ? b.cross : b.cross + b.cl;
    const k = Math.abs(cb - ca) / 3;
    const pts: [Pt, Pt, Pt, Pt] = [toPt(am, ca), toPt(am, ca + (down ? k : -k)), toPt(bm, cb - (down ? k : -k)), toPt(bm, cb)];
    return { edge, pts, label: bezier(pts, 0.5) };
  }
  // loop around one side: back edges, and any edge given an explicit side
  const edgeA = sign > 0 ? a.cross + a.cl : a.cross;
  const edgeB = sign > 0 ? b.cross + b.cl : b.cross;
  const outer = sign > 0 ? Math.max(edgeA, edgeB) : Math.min(edgeA, edgeB);
  const span = Math.abs(b.main - a.main);
  const depth = 26 + Math.min(40, span / 10) + (edge.depth ?? 0);
  const p0 = toPt(a.main + a.ml / 2, edgeA);
  const p3 = toPt(b.main + b.ml / 2, edgeB);
  const pts: [Pt, Pt, Pt, Pt] = [p0, toPt(a.main + a.ml / 2, outer + sign * depth * 1.3), toPt(b.main + b.ml / 2, outer + sign * depth * 1.3), p3];
  return { edge, pts, label: bezier(pts, 0.5) };
}
