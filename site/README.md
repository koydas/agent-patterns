# agent-patterns playground

The interactive site at <https://koydas.github.io/agent-patterns/>: every pattern of this repository as a
deterministic simulation — play, pause, step, change parameters, trigger failure modes, compare two
configurations side by side. React 19 + TypeScript + Vite, custom SVG, no backend, no API key.

```bash
npm ci
npm run dev        # http://localhost:5173/agent-patterns/
npm test           # engine, every pattern's presets, invariants, ports vs impl.mjs, controls
npm run build      # dist/ with one prerendered HTML page per route
```

## How it is built

| Layer | Where | Rule |
|---|---|---|
| Content | `scripts/catalog.mjs`, `scripts/content-plugin.mjs` | Read at build time from the repo: pattern READMEs (rendered to HTML, code-split per page), the root README tables (category, problem, "Running in"), `_data/patterns.yml` (title, description). Nothing is restated in the site. |
| Simulation | `src/patterns/<name>.ts` | `simulate(config, seed) → events`. Pure, deterministic; randomness is keyed (`rand(seed, 'review', round)`), so two configurations see the same draws (common random numbers in Compare). |
| Engine | `src/engine/` | `buildTrace` folds events; `frameAt(trace, clock)` is the whole visible state; playback is a clock over simulated time shared by both scenarios in Compare. A parameter change restarts the run unless the history up to the clock is unchanged. |
| Fidelity | `src/patterns/ports.ts`, `src/test/ports.test.ts` | Pure functions of `impl.mjs` that import `node:` builtins are ported and checked against the real impl on input grids. `bounded-feedback-injection` and `eval-gate-ratchet` import their `impl.mjs` directly. |
| Metrics | each pattern's `derive` | Computed from the event history (or, marked *theoretical*, from a counterfactual run of the same simulator). Latency, tokens and probabilities are simulated inputs, never measurements. |
| Routes | `src/router.ts`, `scripts/prerender.mjs` | Same URLs as the former Jekyll site (`/agent-patterns/patterns/<name>/`), each prerendered with its README text, title, description and canonical URL; `sitemap.xml`; raw `README.md` / `impl.mjs` copied alongside. |

Deployment: `.github/workflows/pages.yml` (Settings → Pages → Source must be **GitHub Actions**).
