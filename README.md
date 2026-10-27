# agent-patterns

**20 patterns for multi-agent systems — each with a diagram, trade-offs, failure modes, when *not* to use it, and a runnable `impl.mjs`.**

Not a framework. Every pattern here was named after the problem it solved in a pipeline that runs: 16 of 20 have implementations in public repos, [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) (GitHub Actions, headless) and [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) (Claude Code, interactive), and every row names where. The remaining patterns are marked as reference implementations. 11 patterns also have a **Where it came from** section linking the incident or ADR that forced them — for example, `loop-with-guard` exists because an auto-fix agent replaced a 26-test suite with an 18-line stub.

Try one without an API key: `node --test patterns/tool-grounded-review/impl.test.mjs` (11 tests), or see [Run one](#run-one).

How four of them compose in `autonomous-dev-loop`:

```mermaid
flowchart LR
    I([Issue]) --> V["validator-first<br/>under-specified issues stop here"]
    V -->|"label: ready-for-dev"| G[Code generation]
    G --> E["tool-grounded-review<br/>failing check forces REQUEST_CHANGES"]
    E -->|changes requested| F["loop-with-guard<br/>auto-fix, max 3 attempts"]
    F --> E
    E -->|approved| H(["human-gate<br/>a person merges"])
    F -->|attempts exhausted| H
```

Labels carry the state between those workflows: that's [label-driven-state-machine](./patterns/label-driven-state-machine/).

## Find a pattern by the problem you have

### Flow control

| Your problem | Pattern | Running in |
|---|---|---|
| Agents hand each other prose instead of contracts; a failure mid-chain goes unnoticed | [sequential-pipeline](./patterns/sequential-pipeline/) | [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `ticket-analyst → code-builder → code-reviewer` |
| One generalist prompt handles bug fixes, features and refactors equally badly | [router](./patterns/router/) | [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `issue-router` agent |
| Pipeline state across async workflows is invisible and hard to pass along | [label-driven-state-machine](./patterns/label-driven-state-machine/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — four workflows chained by labels, retries by label re-pulse |
| A failure class is mostly structural, but a model fixes it and sometimes rewrites what it should not | [escalation-ladder](./patterns/escalation-ladder/) | Reference only — designed and implemented in [`autonomous-dev-loop` PR #294](https://github.com/koydas/autonomous-dev-loop/pull/294) (conflicts-fix), not merged yet |
| Independent subtasks run one after another | [fan-out](./patterns/fan-out/) | Reference only (mocked workers) |
| The best fix strategy is unknown upfront | [speculative-race](./patterns/speculative-race/) | Reference only (mocked selector) |

### Quality gates

| Your problem | Pattern | Running in |
|---|---|---|
| Vague issues burn tokens and come back as garbage PRs | [validator-first](./patterns/validator-first/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — `needs-refinement` blocks generation |
| The coder ↔ reviewer loop never ends, or ends on a malformed verdict | [loop-with-guard](./patterns/loop-with-guard/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — 3-attempt cap, then escalation |
| A failing eval is made green by weakening thresholds, dropping cases, or filtering the suite | [eval-gate-ratchet](./patterns/eval-gate-ratchet/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — pinned thresholds, datasets and full-suite CI (ADR-0031) |
| The LLM reviewer approves a PR whose tests are red | [tool-grounded-review](./patterns/tool-grounded-review/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — secret-free evidence job forces `REQUEST_CHANGES` ([ADR-0024](https://github.com/koydas/autonomous-dev-loop/blob/main/docs/adr/0024-tool-evidence-for-pr-review.md)); [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — evidence-table gate |
| A single-pass reviewer misses adversarial edge cases | [critic-pair](./patterns/critic-pair/) | [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `code-challenger`, `--strict` |
| Nobody can tell whether every acceptance criterion was implemented | [ac-traceability](./patterns/ac-traceability/) | [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — AC coverage block + `/ac-check` |
| A "bug fix" ships with no proof it ever reproduced the bug | [typed-evidence-chain](./patterns/typed-evidence-chain/) | [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — bug / refactor / feature builders with typed evidence |
| An agent merges or deploys on its own | [human-gate](./patterns/human-gate/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop), [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — merge is always human |

### Reliability and cost

| Your problem | Pattern | Running in |
|---|---|---|
| Recurring failures should improve the next prompt without feeding untrusted model text back as instructions | [bounded-feedback-injection](./patterns/bounded-feedback-injection/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — fixed lessons catalog and bounded prompt injection (ADR-0051) |
| An automated upgrade passes on empty storage but breaks existing data | [stateful-upgrade-verification](./patterns/stateful-upgrade-verification/) | [`fullstack-pilot`](https://github.com/koydas/fullstack-pilot) — stateful database upgrade CI (general reliability, not agent-specific) |
| A rate limit at step 4 restarts the whole pipeline | [checkpoint-resume](./patterns/checkpoint-resume/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — checkpoints as Actions artifacts; [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) — `checkpoint.mjs` + `/resume` |
| The invariant system prompt is re-billed on every call; changing a guardrail needs a code change | [staged-prompt-separation](./patterns/staged-prompt-separation/) | [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) — `*-system.md` / `*-user.md` pairs, prompt caching on the Anthropic provider path |
| The same review nit comes back on every PR | [reflexive-loop](./patterns/reflexive-loop/) | Reference only — injection points exist, no automated learn step yet |
| You want the pipeline to tell you what to change in itself, but anything it creates (an issue, a PR) comes back in as input | [read-only-meta-loop](./patterns/read-only-meta-loop/) | Implemented — [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) exports findings and maps guarded levers; [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) provides the human-invoked, read-only `/loop-insights` command (live publication not independently verified) |

## Run one

Five patterns run offline, no API key:

```bash
git clone https://github.com/koydas/agent-patterns && cd agent-patterns
node patterns/label-driven-state-machine/impl.mjs   # simulated GitHub label events
node patterns/fan-out/impl.mjs
node patterns/speculative-race/impl.mjs
node patterns/read-only-meta-loop/impl.mjs         # sample findings → suggested levers, writes nothing
node patterns/escalation-ladder/impl.mjs           # deterministic rungs, then a stubbed model with a post-check, then a human
```

The others call the Claude API:

```bash
npm install @anthropic-ai/sdk
export ANTHROPIC_API_KEY=...
node patterns/loop-with-guard/impl.mjs
```

`tool-grounded-review`, `read-only-meta-loop` and `escalation-ladder` ship with their own tests: `node --test patterns/tool-grounded-review/impl.test.mjs patterns/read-only-meta-loop/impl.test.mjs patterns/escalation-ladder/impl.test.mjs`.

`bounded-feedback-injection`, `stateful-upgrade-verification` and `eval-gate-ratchet` are pure offline functions with no CLI entry point, exercised by tests only: `node --test patterns/bounded-feedback-injection/impl.test.mjs patterns/stateful-upgrade-verification/impl.test.mjs patterns/eval-gate-ratchet/impl.test.mjs`.

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

The line budget is a target, not a cap. Where the guards *are* the pattern, the implementation keeps them rather than hiding them: `loop-with-guard` (~130 lines: strict verdict parsing, reviewer-side repair, three escalation paths), `speculative-race` (~110 lines: per-strategy deadlines and failure filtering) `tool-grounded-review` (~200 lines: both variants, a fail-closed gate with flaky and removed-script detection, isolated env and HOME, symlink-safe reads) and `staged-prompt-separation` (~200 lines, ~100 of them an inline system prompt sized past the provider's cacheable-prefix minimum so the second call shows a cache hit) run longer on purpose.

---

## Related

| Repo | What it demonstrates |
|---|---|
| [`autonomous-dev-loop`](https://github.com/koydas/autonomous-dev-loop) | `validator-first` + `label-driven-state-machine` + `loop-with-guard` + `tool-grounded-review` + `staged-prompt-separation` + `checkpoint-resume` + `human-gate` in a GitHub Actions pipeline |
| [`ai-dev-tools`](https://github.com/koydas/ai-dev-tools) | `router` + `sequential-pipeline` + `typed-evidence-chain` + `ac-traceability` + `critic-pair` + `tool-grounded-review` + `checkpoint-resume` + `human-gate` in a Claude Code toolbox |
