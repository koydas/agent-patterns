# sequential-pipeline

Agents run in a fixed order with structured handoff contracts. Each agent produces a `### Status` / `### Handoff` block consumed by the next.

## How it works

1. The **ticket-analyst** parses the issue and produces a structured plan.
2. The **code-builder** implements the plan.
3. The **code-reviewer** reviews the output and returns a verdict.

Each stage reads only the `### Handoff` block from the previous stage — not the full output. If any stage emits `### Status: BLOCKED`, the pipeline halts.

## When to use

- Tasks with well-defined, sequential stages where each stage's output is the next stage's input.
- Pipelines where partial progress is meaningful and stageability matters (easier to debug and resume).

## When not to use

- Tasks where stages are not naturally ordered or where a later stage frequently needs to send work back upstream.
- Short tasks where the structured handoff overhead exceeds the benefit.

## Trade-offs

| | |
|---|---|
| **Pro** | Clear separation of concerns — each agent is focused and auditable |
| **Pro** | A blocked stage surfaces the failure at the right layer |
| **Con** | Handoff contracts must be stable — changing the schema breaks downstream agents |
| **Con** | No backtracking — a flaw introduced in stage 1 propagates through stage 2 before being caught in stage 3 |

## Failure modes

- **Schema drift** — one agent changes its `### Handoff` format; the next agent misparses it.
- **Silent truncation** — a long handoff block is silently cut off by a context limit before reaching the next agent.
