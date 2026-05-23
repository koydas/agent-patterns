# fan-out

A task is split into independent subtasks, each handled by a separate agent in parallel. Results are merged by an aggregator agent.

## How it works

1. The **dispatcher** breaks the task into N independent subtasks.
2. N **worker agents** run in parallel, each processing one subtask.
3. The **aggregator** receives all results and produces a single merged output.

## When to use

- Tasks that decompose naturally into independent units (e.g. reviewing multiple files, generating multiple variants, analyzing multiple dimensions).
- Situations where parallelism meaningfully reduces wall-clock time.

## When not to use

- Tasks where subtasks depend on each other — use a sequential pipeline instead.
- When N is unbounded or large enough to hit rate limits or incur significant cost.

## Trade-offs

| | |
|---|---|
| **Pro** | Wall-clock time scales with the slowest subtask, not the sum |
| **Pro** | Each worker is focused and isolated — easy to reason about |
| **Con** | All subtasks must complete before the aggregator can run |
| **Con** | A single slow or failed worker blocks the merge step |

## Failure modes

- **Partial failure** — one worker fails; the aggregator receives incomplete results and may produce a misleading summary.
- **Cost explosion** — N subtasks × M tokens each; unbounded fan-out is expensive.
