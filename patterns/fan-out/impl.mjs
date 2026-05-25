// Fan-out pattern: split a task into N independent subtasks, dispatch them
// in parallel across N workers, merge results via an aggregator.

// --- Mock workers (swap for real agent calls) ---

async function worker(name, subtask) {
  await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
  return {
    worker: name,
    subtask,
    result: `${name} completed: "${subtask}"`,
  };
}

// --- Mock aggregator ---

async function aggregator(task, workerOutputs) {
  await new Promise(r => setTimeout(r, 20));
  // In a real system: an LLM synthesizes worker results into a coherent output.
  const body = workerOutputs.map(o => `  [${o.worker}] ${o.result}`).join('\n');
  return `Summary for "${task}":\n${body}`;
}

// --- Orchestrator ---

function decompose(task) {
  // In a real system: an LLM or rule-based splitter produces independent subtasks.
  return [
    { name: 'subtask-1', description: `${task} — scope: authentication layer` },
    { name: 'subtask-2', description: `${task} — scope: data access layer` },
    { name: 'subtask-3', description: `${task} — scope: API surface` },
  ];
}

async function fanOut(task) {
  console.log(`[orchestrator] task: "${task}"`);

  const subtasks = decompose(task);
  const workerNames = subtasks.map((_, i) => `worker-${i + 1}`);

  console.log(`[orchestrator] fanning out to ${subtasks.length} workers in parallel`);
  subtasks.forEach((s, i) => console.log(`  ${workerNames[i]}: "${s.description}"`));
  console.log();

  const t0 = Date.now();

  const outputs = await Promise.all(
    subtasks.map((subtask, i) =>
      worker(workerNames[i], subtask.description).then(output => {
        console.log(`  [${output.worker}] done (${Date.now() - t0}ms)`);
        return output;
      })
    )
  );

  console.log(`\n[aggregator] merging ${outputs.length} results...`);
  const summary = await aggregator(task, outputs);
  console.log('[aggregator] done\n');

  return summary;
}

// --- Entry point ---

const result = await fanOut('Audit the user authentication system');

console.log('=== AGGREGATED RESULT ===\n');
console.log(result);
