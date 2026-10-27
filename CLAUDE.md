# CLAUDE.md — agent-patterns

20 multi-agent patterns, each `patterns/<name>/{README.md,impl.mjs}` (ESM, Node ≥ 20). Reference: `README.md` → Structure, Production notes.

- Implementations stay minimal (~50–100 lines) unless the guards are the pattern.
- Offline-runnable patterns need no API key; others target `claude-opus-5-5`.
- A "Running in" claim names a real repo; otherwise mark the pattern "Reference only".

Procedures in `.claude/skills/`: `new-pattern`.

## Toolbox — koydas/ai-dev-tools

`.claude/settings.json` declares the `ai-dev-tools` plugin (trust the folder → install offered): `/ai-dev-tools:pr-review <n>`, `/ai-dev-tools:pr-fixer`, `/ai-dev-tools:issue-code-generation <n>`, `/ai-dev-tools:ac-check <n>`. Repo rules (this file, `.claude/skills/`) win over toolbox defaults.

Cloud sessions (claude.ai/code) do not install repository-declared plugins: environment setup script in the ai-dev-tools README → "Use from another repository". Commands are then un-prefixed (`/pr-review`). Details: [`docs/claude-code.md`](docs/claude-code.md).
