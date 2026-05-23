# agent-patterns

Patterns for multi-agent systems — named, documented, implemented.

Each pattern emerged from a real pipeline. The goal is not a framework: it's a reference for decisions that recur when building agentic workflows.

---

## Patterns

### [loop-with-guard](./patterns/loop-with-guard/)
An agent iterates in a loop — coder → reviewer → coder — with an explicit exit condition and a round cap to prevent infinite loops.

**Implemented in:** [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — the reviewer either approves or requests changes; the coder retries up to N rounds before escalating to the human gate.

---

### [validator-first](./patterns/validator-first/)
A validation agent runs before the main pipeline is triggered. Issues that don't pass the gate never enter the loop.

**Implemented in:** [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — the Issue Validation Agent blocks under-specified issues with a `needs-refinement` label before any code is generated.

---

### [sequential-pipeline](./patterns/sequential-pipeline/)
Agents run in a fixed order with structured handoff contracts. Each agent produces a `### Status / ### Handoff` block consumed by the next.

**Implemented in:** [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `ticket-analyst → code-builder → code-reviewer` via `/issue-code-generation`.

---

### [human-gate](./patterns/human-gate/)
A human approval step is placed at the boundary between autonomous execution and irreversible action. The system stops and waits — it does not proceed on timeout.

**Implemented in:** [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) and [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — the merge step is always human-controlled, regardless of reviewer verdict.

---

### [fan-out](./patterns/fan-out/)
A task is split into independent subtasks, each handled by a separate agent in parallel. Results are merged by an aggregator agent.

---

## Structure

```
patterns/
└── <pattern-name>/
    ├── README.md     pattern description, diagram, trade-offs, when not to use
    └── impl.mjs      minimal working implementation (~50-100 lines)
```

---

## Related

| Repo | What it demonstrates |
|---|---|
| [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) | `loop-with-guard` + `validator-first` + `human-gate` in a GitHub Actions pipeline |
| [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) | `sequential-pipeline` + `human-gate` in a Claude Code toolbox |
