// Speculative-race pattern: launch the same task across N strategies in
// parallel, wait for all to complete, select the best result via a selector.

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

async function runStrategy(strategy, task) {
  await new Promise(r => setTimeout(r, 40 + Math.random() * 80));
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

  const candidates = await Promise.all(
    STRATEGIES.map(strategy =>
      runStrategy(strategy, task).then(result => {
        console.log(`  [${result.strategy}] done (${Date.now() - t0}ms)`);
        return result;
      })
    )
  );

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
