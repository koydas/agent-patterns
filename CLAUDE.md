# CLAUDE.md — agent-patterns

21 multi-agent patterns, each `patterns/<name>/{README.md,impl.mjs}` (ESM, Node ≥ 20). Reference: `README.md` → Structure, Production notes.

- Implementations stay minimal (~50–100 lines) unless the guards are the pattern.
- Offline-runnable patterns need no API key; others target `claude-opus-5-5`.
- A "Running in" claim names a real repo; otherwise mark the pattern "Reference only".
- `site/` is the GitHub Pages playground (React + Vite + TS): content comes from the READMEs, the root README tables and `_data/patterns.yml` at build time; each pattern has a deterministic simulation in `site/src/patterns/<name>.ts`. Checks from `site/`: `npm run lint && npm test && npm run build`. Simulated values are never presented as measurements.

- `site/src/site-kit/` is a vendored copy of the shared shell of koydas/koydas (`site-kit/`, ADR-0001): top bar with site switcher, footer, page header, tokens. Never edit it by hand: sync it (`node site-kit/scripts/kit.mjs sync --target site/src/site-kit --profile react` from a koydas/koydas checkout); `site/src/test/site-kit.test.tsx` fails when the copy drifts from the version and hash in its `KIT.json`.
- A pattern page links the dashboards of the repos its "Running in" cell names, only for `production` patterns.

Procedures in `.claude/skills/`: `new-pattern`.

## Toolbox — koydas/ai-dev-tools

`.claude/settings.json` declares the `ai-dev-tools` plugin (trust the folder → install offered): `/ai-dev-tools:pr-review <n>`, `/ai-dev-tools:pr-fixer`, `/ai-dev-tools:issue-code-generation <n>`, `/ai-dev-tools:ac-check <n>`. Repo rules (this file, `.claude/skills/`) win over toolbox defaults.

Cloud sessions (claude.ai/code) do not install repository-declared plugins: environment setup script in the ai-dev-tools README → "Use from another repository". Commands are then un-prefixed (`/pr-review`). Details: [`docs/claude-code.md`](docs/claude-code.md).
