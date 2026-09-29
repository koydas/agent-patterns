// Speculative-race pattern: launch the same task across N strategies in
// parallel, wait for all to settle, select the best successful result via a selector.

const STRATEGY_TIMEOUT_MS = 2_000;

// Exercise the failure paths: FAIL_STRATEGY=robust or HANG_STRATEGY=refactor
const FAIL_STRATEGY = process.env.FAIL_STRATEGY;
const HANG_STRATEGY = process.env.HANG_STRATEGY;

// --- Strategies (swap runStrategy for real agent calls with distinct prompts) ---

const STRATEGIES = [
  {
    name: 'minimal',
    description: 'smallest change that solves the problem, no extras',
  },
  {
    name: 'robust',
    description: 'complete solution with validation, error handling, and edge cases',
  },
  {
    name: 'refactor',
    description: 'solve the problem and improve surrounding code quality',
  },
];

// Abortable delay standing in for an agent call. A real call must forward the
// signal too, e.g. client.messages.create(params, { signal }).
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

async function runStrategy(strategy, task, signal) {
  if (strategy.name === FAIL_STRATEGY) throw new Error('simulated failure');
  const ms = strategy.name === HANG_STRATEGY ? 2 ** 31 - 1 : 40 + Math.random() * 80;
  await sleep(ms, signal);
  return {
    strategy: strategy.name,
    approach: strategy.description,
    output: `[${strategy.name}] Solution to "${task}" — approach: ${strategy.description}`,
  };
}

// --- Mock selector ---

async function selector(task, candidates) {
  await new Promise(r => setTimeout(r, 20));
  // In a real system: an LLM scores each candidate against quality criteria.
  // Here: deterministic pick of the first candidate (mock — replace with LLM call).
  void task;
  return candidates[0];
}

// --- Orchestrator ---

async function speculativeRace(task) {
  console.log(`[orchestrator] task: "${task}"`);
  console.log(`[orchestrator] launching ${STRATEGIES.length} strategies in parallel\n`);

  const t0 = Date.now();

  // allSettled, not all: one failing strategy must not discard the others.
  // The per-strategy deadline stops one hanging strategy from blocking them all.
  const settled = await Promise.allSettled(
    STRATEGIES.map(strategy =>
      runStrategy(strategy, task, AbortSignal.timeout(STRATEGY_TIMEOUT_MS)).then(result => {
        console.log(`  [${result.strategy}] done (${Date.now() - t0}ms)`);
        return result;
      })
    )
  );

  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      console.log(`  [${STRATEGIES[i].name}] failed: ${s.reason?.message ?? s.reason}`);
    }
  });

  const candidates = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  if (candidates.length === 0) {
    throw new Error('All strategies failed — nothing to select from');
  }
  if (candidates.length < STRATEGIES.length) {
    console.log(`  degraded: ${candidates.length}/${STRATEGIES.length} strategies succeeded`);
  }

  console.log(`\n[selector] evaluating ${candidates.length} candidates...`);
  const winner = await selector(task, candidates);
  console.log(`[selector] chose: ${winner.strategy}\n`);

  return { candidates, winner };
}

// --- Entry point ---

const { candidates, winner } = await speculativeRace(
  'Users are logged out mid-form after 5 minutes of inactivity'
);

console.log('=== ALL CANDIDATES ===');
candidates.forEach(c => console.log(`  [${c.strategy}] ${c.output}`));

console.log('\n=== WINNER ===');
console.log(`Strategy: ${winner.strategy}`);
console.log(`Approach: ${winner.approach}`);
console.log(`Output:   ${winner.output}`);
