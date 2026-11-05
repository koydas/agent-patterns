import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrace, defaults, normalize, runSim } from '../engine/trace';
import { ALL, SIMS } from '../patterns';
import type { Config, PatternSim } from '../engine/types';

const ROOT = join(__dirname, '../../..');

function configs(sim: PatternSim): [string, Config, number][] {
  return [
    ['defaults', defaults(sim), 7],
    ...sim.presets.map((p) => [`preset ${p.id}`, normalize(sim, p.config), p.seed ?? 7] as [string, Config, number]),
    ...sim.comparePresets.flatMap((p) => [[`compare ${p.id} A`, normalize(sim, p.a.config), p.seed ?? 7], [`compare ${p.id} B`, normalize(sim, p.b.config), p.seed ?? 7]] as [string, Config, number][]),
  ];
}

describe('registry', () => {
  it('has one simulation per pattern directory', () => {
    const dirs = readdirSync(join(ROOT, 'patterns'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(Object.keys(SIMS).sort()).toEqual(dirs);
  });
});

describe.each(ALL.map((s) => [s.slug, s] as const))('%s', (_slug, sim) => {
  it('declares a well-formed graph for every preset', () => {
    for (const [, c] of configs(sim)) {
      const g = sim.graph(c);
      const ids = new Set(g.nodes.map((n) => n.id));
      expect(ids.size).toBe(g.nodes.length);
      for (const e of g.edges) {
        expect(ids.has(e.from), `${e.id}.from`).toBe(true);
        expect(ids.has(e.to), `${e.id}.to`).toBe(true);
      }
    }
  });

  it.each(configs(sim))('%s: ends once, references only its graph, and replays identically', (_name, c, seed) => {
    const g = sim.graph(c);
    const nodes = new Set(g.nodes.map((n) => n.id));
    const edges = new Set(g.edges.map((e) => e.id));
    const run = runSim(sim, c, seed);
    expect(run.trace.outcome).not.toBeNull();
    const end = run.trace.events.find((e) => e.type === 'end')!;
    expect(end.t, 'the end is the last moment of the run').toBe(run.trace.duration);
    for (const e of run.trace.events) {
      if (e.type === 'node') expect(nodes.has(e.node), `node ${e.node}`).toBe(true);
      if (e.type === 'transit') expect(edges.has(e.edge), `edge ${e.edge}`).toBe(true);
      if (e.type === 'log' && e.node) expect(nodes.has(e.node), `log node ${e.node}`).toBe(true);
    }
    expect(run.trace.events.filter((e) => e.type === 'log').length).toBeGreaterThan(0);
    expect(buildTrace(sim.simulate(c, seed))).toEqual(run.trace);
    for (const m of sim.metrics) expect(m.key in run.metrics, `metric ${m.key}`).toBe(true);
    expect(sim.explain(run.trace, c, seed).length).toBeGreaterThan(0);
  });

  it('every parameter has a usable default and visible label', () => {
    for (const p of sim.params) {
      expect(p.label.length).toBeGreaterThan(0);
      if (p.type === 'number') expect(p.default).toBeGreaterThanOrEqual(p.min);
      if (p.type === 'select') expect(p.options.some((o) => o.value === p.default)).toBe(true);
    }
  });

  it('builds comparisons from the same pattern definition', () => {
    for (const p of sim.comparePresets) {
      const a = runSim(sim, normalize(sim, p.a.config), p.seed ?? 7);
      const b = runSim(sim, normalize(sim, p.b.config), p.seed ?? 7);
      if (sim.compare) expect(Array.isArray(sim.compare(a, b))).toBe(true);
    }
  });
});
