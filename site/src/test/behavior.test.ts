// The invariant each playground claims to show, asserted on the simulated history.
import { normalize, runSim } from '../engine/trace';
import { SIMS } from '../patterns';
import type { Config } from '../engine/types';

const run = (slug: string, c: Partial<Config>, seed = 7) => runSim(SIMS[slug], normalize(SIMS[slug], c), seed);

describe('loop-with-guard', () => {
  it('a reviewer that never approves ends at the cap, escalated, after exactly max rounds', () => {
    for (const maxRounds of [1, 3, 10]) {
      const r = run('loop-with-guard', { approval: 0, maxRounds });
      expect(r.metrics.outcome).toBe('ESCALATED — round cap reached');
      expect(r.metrics.rounds).toBe(maxRounds);
    }
  });
  it('a reviewer that never parses fails closed in round 1 after one repair turn', () => {
    const r = run('loop-with-guard', { validity: 0 });
    expect(r.metrics.outcome).toBe('ESCALATED — no valid verdict');
    expect(r.metrics.rounds).toBe(1);
    expect(r.metrics.repairs).toBe(1);
    expect(run('loop-with-guard', { validity: 0, repair: 'none' }).metrics.repairs).toBe(0);
  });
  it('common random numbers: a higher cap replays the same early rounds', () => {
    for (let seed = 0; seed < 40; seed++) {
      const a = run('loop-with-guard', { maxRounds: 2, approval: 25 }, seed);
      const b = run('loop-with-guard', { maxRounds: 5, approval: 25 }, seed);
      if (String(a.metrics.outcome).startsWith('APPROVED')) expect(b.metrics).toMatchObject({ outcome: a.metrics.outcome, rounds: a.metrics.rounds, tokens: a.metrics.tokens });
      else expect(Number(b.metrics.rounds)).toBeGreaterThanOrEqual(2);
      expect(Number(b.metrics.worst)).toBeGreaterThan(Number(a.metrics.worst));
    }
  });
});

describe('fan-out', () => {
  it('8 tasks of 1000 ms: one worker spans 8000 ms, four workers 2000 ms (4×)', () => {
    const a = run('fan-out', { tasks: 8, workers: 1, latency: 1000, variance: 0 });
    const b = run('fan-out', { tasks: 8, workers: 4, latency: 1000, variance: 0 });
    expect(a.metrics.span).toBe(8000);
    expect(b.metrics.span).toBe(2000);
    expect(b.metrics.speedup).toBe(4);
    expect(a.metrics.compute).toBe(b.metrics.compute); // parallelism does not reduce total work
  });
  it('Promise.all loses everything on one failure; allSettled merges the survivors', () => {
    const all = run('fan-out', { tasks: 5, workers: 5, failure: 30 }, 5);
    const settled = run('fan-out', { tasks: 5, workers: 5, failure: 30, aggregation: 'settled' }, 5);
    expect(Number(all.metrics.failed)).toBeGreaterThan(0);
    expect(all.trace.outcome?.label).toMatch(/^FAILED/);
    expect(settled.trace.outcome?.label).toMatch(/^PARTIAL/);
  });
});

describe('tool-grounded-review', () => {
  it('a model approval never overrides a failing test', () => {
    const r = run('tool-grounded-review', { test: 'FAIL', verdict: 'APPROVED' });
    expect(r.trace.outcome?.label).toBe('REQUEST_CHANGES — model approval overridden');
  });
  it('the LLM-only baseline approves the same change', () => {
    expect(run('tool-grounded-review', { mode: 'llm', test: 'FAIL', verdict: 'APPROVED' }).trace.outcome?.label).toBe('APPROVED (model only)');
  });
  it('flaky, timed-out and removed checks block under the impl policy, and only FAIL blocks under ADL\'s', () => {
    for (const test of ['FLAKY', 'UNVERIFIED', 'REMOVED']) {
      expect(run('tool-grounded-review', { test }).trace.outcome?.label).toMatch(/^BLOCKED/);
      expect(run('tool-grounded-review', { test, policy: 'surface' }).trace.outcome?.label).toMatch(/^APPROVED with unverified/);
    }
  });
  it('a prose verdict is never an approval', () => {
    expect(run('tool-grounded-review', { test: 'PASS', verdict: 'malformed' }).trace.outcome?.label).toBe('Not approved by the model');
  });
});

describe('checkpoint-resume', () => {
  it('resuming repeats only the interrupted step; restarting repeats every completed one', () => {
    const resume = run('checkpoint-resume', { stages: 5, failAt: '4' });
    const restart = run('checkpoint-resume', { stages: 5, failAt: '4', recovery: 'restart' });
    expect(resume.metrics.repeated).toBe(1);
    expect(restart.metrics.repeated).toBe(4);
    expect(Number(resume.metrics.saved)).toBeGreaterThan(0);
    expect(Number(resume.metrics.duration)).toBeLessThan(Number(restart.metrics.duration));
  });
  it('a torn non-atomic write forces a full restart', () => {
    const r = run('checkpoint-resume', { stages: 4, failAt: '3', crashWhen: 'after', atomic: false });
    expect(r.trace.counters.corrupt).toBe(1);
    expect(r.metrics.repeated).toBe(3);
  });
});

describe('router', () => {
  it('a perfect router never misroutes known categories', () => {
    expect(run('router', { category: 'SECURITY', accuracy: 100, tasks: 12 }).metrics.misrouted).toBe(0);
  });
  it('off-taxonomy tasks default to FEATURE (impl) or reach the generalist', () => {
    expect(run('router', { category: 'DOCS', tasks: 3 }).metrics.defaulted).toBe(3);
    expect(run('router', { category: 'DOCS', tasks: 3, unknown: 'generalist' }).metrics.generalist).toBe(3);
  });
});

describe('human-gate', () => {
  it('the irreversible action runs only on an explicit yes', () => {
    expect(run('human-gate', {}).metrics.action).toBe('executed after approval');
    for (const c of [{ answer: 'no' }, { answer: 'none' }, { refusal: true }, { responseS: 50, timeoutS: 30 }]) {
      expect(run('human-gate', c).metrics.action).toBe('not executed');
    }
    expect(run('human-gate', { answer: 'none', autoProceed: true }).metrics.action).toBe('EXECUTED without approval');
  });
});

describe('resumable-approval-gate', () => {
  it('a crash after the effect replays the gate but not the effect', () => {
    const r = run('resumable-approval-gate', { crash: true });
    expect(r.metrics.gateRuns).toBe(2);
    expect(r.metrics.effects).toBe(1);
  });
  it('without a key the replay repeats the effect', () => {
    expect(run('resumable-approval-gate', { crash: true, keyed: false }).metrics.effects).toBe(2);
  });
  it('a stale digest or an unknown decision pauses again with no effect', () => {
    expect(run('resumable-approval-gate', { digest: 'stale' }).metrics.effects).toBe(0);
    expect(run('resumable-approval-gate', { decision: 'lgtm' }).metrics.effects).toBe(0);
  });
});

describe('label-driven-state-machine', () => {
  it('escalates after MAX_FIX_ATTEMPTS, as the impl counts attempt labels', () => {
    expect(run('label-driven-state-machine', { approveAfter: 'never' }).trace.outcome?.label).toBe('Escalated after 3 fix attempts');
    expect(run('label-driven-state-machine', { approveAfter: '4' }).trace.outcome?.label).toBe('review-approved after 4 reviews');
    expect(run('label-driven-state-machine', { approveAfter: '5' }).trace.outcome?.label).toBe('Escalated after 3 fix attempts');
  });
});

describe('validator-first', () => {
  it('without the gate every vague issue reaches generation; with it, fewer do', () => {
    const off = run('validator-first', { gate: false, issues: 12 });
    const on = run('validator-first', { issues: 12 });
    expect(Number(on.metrics.wasted)).toBeLessThan(Number(off.metrics.wasted));
  });
});

describe('eval-gate-ratchet (real checkRatchet)', () => {
  it('blocks every weakening and allows tightening', () => {
    for (const c of [{ min: 70 }, { max: 20 }, { optional: true }, { removeCase: true }, { relabel: true }, { knownGap: true }, { filtered: true }]) {
      expect(run('eval-gate-ratchet', c).trace.outcome?.label, JSON.stringify(c)).toBe('BLOCKED — the gate was weakened');
    }
    expect(run('eval-gate-ratchet', { min: 82, addCase: true, score: 85 }).trace.outcome?.label).toMatch(/^GREEN/);
  });
});

describe('bounded-feedback-injection (real selectLessons)', () => {
  it('drops untrusted signals and respects the budgets', () => {
    const r = run('bounded-feedback-injection', { untrusted: true, unknownId: true });
    expect(r.metrics.rejected).toBe(2);
    expect(run('bounded-feedback-injection', { maxLessons: 0 }).metrics.lessons).toBe(0);
    expect(Number(run('bounded-feedback-injection', {}).metrics.chars)).toBeLessThanOrEqual(700);
  });
});

describe('escalation-ladder', () => {
  it('a bad model answer escalates the whole item with a closed reason', () => {
    expect(run('escalation-ladder', { bad: 100, structural: 0 }).trace.outcome?.label).toMatch(/invented_content \(hunk 1\)/);
    expect(run('escalation-ladder', { previous: true }).trace.outcome?.label).toBe('ESCALATED — circuit_open');
    expect(run('escalation-ladder', { structural: 100 }).metrics.modelCalls).toBe(0);
  });
});

describe('stateful-upgrade-verification', () => {
  it('a lossy migration passes a fresh-install test and fails the stateful one', () => {
    expect(run('stateful-upgrade-verification', { mode: 'fresh', migration: 'lossy' }).trace.outcome?.label).toBe('GREEN — on empty storage');
    expect(run('stateful-upgrade-verification', { migration: 'lossy' }).trace.outcome?.label).toBe('BLOCKED — data_mismatch');
  });
});

describe('read-only-meta-loop', () => {
  it('writes nothing in read-only mode; a forbidden lever fails the table check', () => {
    expect(run('read-only-meta-loop', {}).metrics.writes).toBe(0);
    expect(run('read-only-meta-loop', { forbidden: true }).trace.outcome?.label).toBe('Lever table rejected by its test');
  });
});

describe('staged-prompt-separation', () => {
  it('caching saves on repeated calls, never on one, never with role bleed', () => {
    expect(Number(run('staged-prompt-separation', {}).metrics.saving)).toBeGreaterThan(0);
    expect(Number(run('staged-prompt-separation', { calls: 1 }).metrics.saving)).toBeLessThan(0);
    expect(run('staged-prompt-separation', { bleed: true }).metrics.hits).toBe(0);
  });
});

describe('review fixes (PR #21)', () => {
  it('fan-out: no worker starts after it finishes, for any allowed latency', () => {
    for (let seed = 0; seed < 30; seed++) for (const latency of [200, 300]) {
      const r = run('fan-out', { tasks: 4, workers: 2, latency, variance: 50 }, seed);
      const last: Record<string, string> = {};
      for (const e of r.trace.events) if (e.type === 'node') last[e.node] = e.status;
      for (const id of ['w0', 'w1']) expect(last[id], `seed ${seed} ${id}`).not.toBe('active');
    }
  });
  it('speculative-race: time to result does not depend on aborting the losers', () => {
    const base = { selection: 'any', failure: 0, checkPass: 100 };
    const aborted = run('speculative-race', { ...base, abort: true });
    const kept = run('speculative-race', { ...base, abort: false });
    expect(kept.metrics.duration).toBe(aborted.metrics.duration);
    expect(kept.trace.duration).toBeGreaterThan(Number(kept.metrics.duration));
    expect(Number(kept.metrics.busy)).toBeGreaterThan(Number(aborted.metrics.busy));
  });
});

describe('review fixes, round 2 (PR #21)', () => {
  it('validator-first: a well-formed verdict passes the prefix parser too', () => {
    const r = run('validator-first', { parsing: 'prefix', malformed: 0, accuracy: 100, vague: 0 });
    expect(r.metrics.blockedGood).toBe(0);
    expect(r.metrics.generated).toBe(8);
  });
  it('speculative-race: the end never precedes the result, even with equal latencies and no abort', () => {
    const r = run('speculative-race', { selection: 'any', abort: false, failure: 0, checkPass: 100, lat0: 200, lat1: 200, lat2: 200 });
    const end = r.trace.events.find((e) => e.type === 'end')!;
    expect(end.t).toBeGreaterThanOrEqual(Number(r.trace.vars.resultAt));
  });
});
