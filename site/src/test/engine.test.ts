import { bezier, layout } from '../engine/layout';
import { Recorder } from '../engine/recorder';
import { chance, jitter, rand } from '../engine/rng';
import { buildTrace, frameAt, nextStop, normalize, samePrefix, stepTimes } from '../engine/trace';
import { readUrl, toSearch } from '../engine/url';
import { loopWithGuard } from '../patterns/loop-with-guard';

describe('rng', () => {
  it('is a pure function of (seed, keys)', () => {
    expect(rand(7, 'a', 1)).toBe(rand(7, 'a', 1));
    expect(rand(7, 'a', 1)).not.toBe(rand(8, 'a', 1));
    expect(rand(7, 'a', 1)).not.toBe(rand(7, 'a', 2));
  });
  it('stays in [0, 1) and is roughly uniform', () => {
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const u = rand(1, 'u', i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      if (chance(0.3, 1, 'u', i)) hits++;
    }
    expect(hits / 4000).toBeGreaterThan(0.26);
    expect(hits / 4000).toBeLessThan(0.34);
  });
  it('jitter stays within the spread', () => {
    for (let i = 0; i < 200; i++) {
      const v = jitter(1000, 0.2, 3, i);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });
});

describe('trace', () => {
  const r = new Recorder();
  r.node('a', 'active').log('start').wait(100).node('a', 'ok').transit('a-b', 200).count('k', 2).set('v', 'x').log('mid').node('b', 'fail');
  const trace = buildTrace(r.end('done', 'ok'));

  it('folds counters, vars, outcome and duration', () => {
    expect(trace.counters.k).toBe(2);
    expect(trace.vars.v).toBe('x');
    expect(trace.outcome).toEqual({ label: 'done', tone: 'ok' });
    expect(trace.duration).toBe(300);
  });
  it('rejects a history with two end events', () => {
    expect(() => buildTrace([{ t: 0, type: 'end', outcome: 'a', tone: 'ok' }, { t: 1, type: 'end', outcome: 'b', tone: 'ok' }])).toThrow();
  });
  it('derives the state at any clock from the history', () => {
    expect(frameAt(trace, 0).nodes.a.status).toBe('active');
    const mid = frameAt(trace, 200);
    expect(mid.nodes.a.status).toBe('ok');
    expect(mid.transits).toEqual([{ edge: 'a-b', p: 0.5, tone: undefined, label: undefined }]);
    const end = frameAt(trace, 300);
    expect(end.visited.has('a-b')).toBe(true);
    expect(end.nodes.b.status).toBe('fail');
    expect(end.logIndex).toBe(1);
    expect(end.outcome?.label).toBe('done');
  });
  it('steps from log entry to log entry', () => {
    expect(stepTimes(trace)).toEqual([0, 300]);
    expect(nextStop([trace], 0)).toBe(300);
  });
  it('detects an unchanged past', () => {
    const r2 = new Recorder();
    r2.node('a', 'active').log('start').wait(100).node('a', 'fail');
    const other = buildTrace(r2.end('x', 'fail'));
    expect(samePrefix(trace, other, 50)).toBe(true);
    expect(samePrefix(trace, other, 100)).toBe(false);
  });
});

describe('config', () => {
  it('clamps, snaps and coerces values; drops unknown keys', () => {
    const c = normalize(loopWithGuard, { maxRounds: 99, approval: '42', repair: 'bogus', refusal: 'true', nope: 1 } as never);
    expect(c.maxRounds).toBe(10);
    expect(c.approval).toBe(40);
    expect(c.repair).toBe('one');
    expect(c.refusal).toBe(true);
    expect('nope' in c).toBe(false);
  });
  it('round-trips through the URL, writing only non-defaults', () => {
    const config = normalize(loopWithGuard, { maxRounds: 3 });
    const q = toSearch(loopWithGuard, { mode: 'explore', config, seed: 11 });
    expect(q).toBe('?maxRounds=3&seed=11');
    expect(readUrl(loopWithGuard, q).config).toEqual(config);
    const cq = toSearch(loopWithGuard, { mode: 'compare', a: normalize(loopWithGuard, { maxRounds: 2 }), b: normalize(loopWithGuard, { maxRounds: 5 }), seedA: 4, seedB: 4 });
    const back = readUrl(loopWithGuard, cq);
    expect(back.mode).toBe('compare');
    expect(back.a.maxRounds).toBe(2);
    expect(back.b.maxRounds).toBe(5);
    expect(back.seedA).toBe(4);
  });
});

describe('layout', () => {
  const g = loopWithGuard.graph(normalize(loopWithGuard, {}));
  it('places every node inside the viewBox in both orientations', () => {
    for (const o of ['LR', 'TD'] as const) {
      const geo = layout(g, o);
      for (const b of Object.values(geo.nodes)) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(geo.width);
        expect(b.y + b.h).toBeLessThanOrEqual(geo.height);
      }
    }
  });
  it('lays out top-to-bottom narrower than left-to-right', () => {
    expect(layout(g, 'TD').width).toBeLessThan(layout(g, 'LR').width);
  });
  it('evaluates edge positions analytically', () => {
    const e = layout(g, 'LR').edges[0];
    expect(bezier(e.pts, 0)).toEqual(e.pts[0]);
    expect(bezier(e.pts, 1)).toEqual(e.pts[3]);
  });
});
