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

### [router](./patterns/router/)
A classifier agent analyzes the input and dispatches to the appropriate specialist agent. The routing decision is made once, upfront.

**Use case:** Incoming issue → router → `bug-fix-agent`, `feature-agent`, `refactor-agent`, or `security-agent`.

**Implemented in:** [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `issue-router` agent dispatches incoming issues to specialist handlers; `code-builder` variants are selected based on routing output.

---

### [critic-pair](./patterns/critic-pair/)
Two agents play adversarial roles before a result is accepted. The proposer produces a solution; the challenger actively tries to break it; a judge makes the final call.

**Use case:** High-stakes logic (auth, parsing, financial calculations) where a single-pass reviewer misses adversarial edge cases.

**Implemented in:** [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `code-challenger` agent, enabled via the `--strict` flag on the review step.

---

### [checkpoint-resume](./patterns/checkpoint-resume/)
The pipeline persists its state after each step. On failure or restart, it resumes from the last saved checkpoint rather than restarting from scratch.

**Use case:** Long pipelines (analyze → plan → implement → test) running in unstable environments — CI runners, rate-limited APIs, serverless.

**Implemented in:** [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `checkpoint.mjs` script + `/resume` command persist and restore pipeline state. Also in [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — pipeline state is persisted via GitHub Actions artifacts across job runs.

---

### [speculative-race](./patterns/speculative-race/)
Multiple agents tackle the same task in parallel with different strategies. All run to completion; a selector agent picks the best result.

**Use case:** Bug with multiple plausible fix strategies (minimal patch vs robust rewrite vs refactor-first) when the best approach is uncertain upfront.

---

### [reflexive-loop](./patterns/reflexive-loop/)
A pipeline captures human feedback, extracts rules via a learn agent, and persists them into its own instruction set. Each subsequent run loads the enriched instructions without human re-intervention.

**Implemented in:** [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `/learn` command + hierarchical `CLAUDE.md` as persistence vector. Also in [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — `REQUEST_CHANGES → fix` cycles as capturable feedback signals injected into `prompts/*.md`.

---

## Production notes

The implementations target `claude-opus-5-5` and stay minimal on purpose. Before running them in production:

- **Read responses by block type.** The model always thinks, so the first content block can be `thinking`; check `stop_reason` before reading `content`. Every `impl.mjs` does this.
- **Allocate effort per role.** Gates and classifiers (`validator-first`, `router`) run at `low`; agents that do the work run at `medium`. Set `effort` explicitly — defaults differ between models. Lowering effort on the most capable model is usually a better first move than a multi-model cascade: one model, one cache namespace.
- **Refusal fallbacks.** Safety classifiers can decline a request (`stop_reason: "refusal"`). The examples surface it (and escalate where the pattern has a gate) but do not retry. In production, opt into server-side fallbacks on the Claude API (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) or the SDK's refusal-fallback middleware on Bedrock, Vertex and Foundry — and log `response.model`, because a fallback silently changes which model answered.
- **Append-only history.** Multi-turn exchanges must pass earlier assistant turns back unchanged, thinking blocks included; editing history invalidates later thinking blocks.
- **`max_tokens` covers thinking + reply.** Size it for both; a limit tuned for a non-thinking model truncates.

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
