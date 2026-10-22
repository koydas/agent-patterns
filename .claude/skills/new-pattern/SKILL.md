---
name: new-pattern
description: Procedure for adding or changing a pattern in agent-patterns — directory layout, README sections, patterns.yml entry, index tables and counts, offline test. Use when creating or renaming a pattern.
---

1. **Files**: `patterns/<kebab-name>/README.md` + `impl.mjs` (ESM, Node ≥ 20, ~50–100 lines; longer only when the guards are the pattern). Read `stop_reason` before `content`; set `effort` explicitly; target `claude-opus-5-5` (README → Production notes).
2. **README sections**, in order, as in `patterns/router/README.md`: `# name`, diagram, `## How it works`, `## When to use`, `## When not to use`, `## Trade-offs`, `## Failure modes`; add `## Where it came from` only with a real incident/ADR link.
3. **`_data/patterns.yml`**: entry keyed by the directory name with `title` and `description` (search/link-preview copy).
4. **Root `README.md`**: a row in the matching "Find a pattern by the problem you have" table; the "Running in" cell names a repo only if it really runs there, else `Reference only`. Update the counts in the intro (`15 patterns`, `12 of 15`, `9 patterns`) and in `_config.yml` `description`; add to the "Run one" lists if it runs offline.
5. **Test**: offline patterns get `node --test patterns/<name>/impl.test.mjs` when they carry non-trivial guards; run it.
