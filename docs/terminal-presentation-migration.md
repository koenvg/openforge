# Terminal presentation migration, KVG-4867

## Scope

Migrated `packages/terminal-runtime` presentation, `plugins/terminal` unavailable-state colors, `src/styles/terminal-presentation.css`, and executable conformance chrome. Existing opacity modifiers, focus colors, native keyboard hints, dimensions, and terminal palette mappings remain intact. Loading uses the SDK indicator with one persistent status announcement rather than two.

No session ownership, PTY identity/filtering, IPC, liveness, resource lifecycle, SDK export, theme ID, or settings business-logic changes. Compatibility CSS and daisyUI remain for other migration tickets. Native prerequisites KVG-4687 and KVG-4864 were both done; neither task was modified.

## Public checks and browser evidence

The confirmed boundaries were rendered feedback and keyboard semantics, mounted terminal contents/session continuity, and browser paint/bounds during theme selection.

- The new loading test failed with two status regions before implementation and passes with one decorative indicator and one announcement.
- The conformance chrome browser test failed when its hard-coded background ignored the supplied surface token. It now follows semantic tokens without changing its 960 × 580 bounds or established default raster palette.
- The browser fixture uses production Svelte components, the real theme registry/document adapter, owner-scoped Terminal Session clients, Terminal Runtime, and xterm. Only the external workspace/PTY transport is simulated. Host and plugin shells remain mounted simultaneously with distinct session keys.
- The browser matrix covers OpenForge Light, OpenForge Dark, Ink, Workshop Light, Workshop Dark, and Copper at 1000 × 800 and 360 × 800. It checks computed paint, dimensions within one CSS pixel, opacity, focus-visible state, scrollbar track/thumb tokens, loading announcements, and native `kbd` identity.
- A contributed theme is unregistered and re-registered with a changed palette and geometry, then selected through the registry. Terminal colors, hint radius/height, and loading dimensions follow the new tokens. Both shells retain their contents, PTY instance 41, liveness, and attachment generation.
- Reduced-motion rendering stops the indicator animation; normal motion animates it. Its 21px baseline size is unchanged. Its SDK border replaces the legacy mask, so the test compares its inherited color and dimensions rather than requiring the old background-fill implementation.
- The matrix runs without daisyUI or the compatibility adapter, then again with the built host CSS to check production utility discovery. The second run uses the same component fixture, not the full production Electron app.

Computed baselines are in `scripts/fixtures/terminal-presentation-baseline.json`, captured from pre-migration commit `179437fa58592281f4576263fbe362b77dd705bc` on Darwin ARM64 with Chromium 151.0.7922.34, Inter/JetBrains Mono, DPR 1, `en-US`, UTC, and reduced motion. Capture reads the requested Git revision without changing the working tree. The fixture neutralizes page scrollbar reservation and uses namespaced local classes to avoid unrelated host status styles.

```sh
# Reproduce the pre-migration measurements, then review before replacing the fixture JSON.
TERMINAL_BASELINE_REF=179437fa58592281f4576263fbe362b77dd705bc \
  node scripts/check-terminal-presentation-themes.mjs --baseline

# Run after pnpm i and the SDK build. The production-CSS mode also needs pnpm build.
node scripts/check-terminal-presentation-themes.mjs
node scripts/check-terminal-presentation-themes.mjs --production-css
```

Reports and command logs are under `artifacts/terminal-presentation/migration/`. Conformance screenshots and its report are under `artifacts/terminal-presentation/`. All 13 platform raster comparisons passed with zero changed pixels; no baselines were updated.

## Complete affected validation

The scope includes the renderer because shared host CSS changed, both terminal packages, the inventory guard, and SDK/publication and bundled-plugin build boundaries. Checks ran serially where browser/build resources could contend.

| Command | Result |
| --- | --- |
| `pnpm i` | Passed. Lockfile unchanged. pnpm reported ignored optional build scripts for `@vgpu/adapter-node`, `esbuild`, and `webgpu`; no approvals changed. |
| `pnpm --filter @openforge-app/terminal-runtime test` | 56 files, 251 passed, 1 opt-in performance test skipped. Baseline before edits: 250 passed, 1 skipped. |
| `pnpm --filter @openforge-app/terminal-runtime build` | Passed, TypeScript no-emit check. |
| `pnpm --filter @openforge-app/terminal-runtime conformance` | Passed on Darwin ARM64: 33 semantic checks and 13 raster comparisons. No environment-related conformance gaps. |
| `pnpm --filter @openforge-app/plugin-terminal test` | 11 files, 47 passed, also passed before edits. |
| `pnpm --filter @openforge-app/plugin-terminal build` | Passed, including SDK build and entrypoint validation. This plugin has no separate typecheck script. |
| `pnpm exec vitest run scripts/terminal-ui-migration.test.mjs scripts/check-ui-migration-inventory.test.mjs` | 28 passed. Final terminal-only rerun passed after accounting for executable test candidates. |
| `pnpm test` | 810 files passed, 9 skipped; 6,793 passed, 3 expected failures, 35 skipped. Final JSON-reporter rerun also exited 0 with no unexpected failures. |
| `pnpm lint` | Passed unused-import, plugin-boundary, and migration checks. 849 inventoried files, 455 presentation files, no violations. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm build` | Passed. Existing chunk-size advisory remains. |
| `pnpm build:plugins` | Passed for all bundled plugins. |
| `pnpm --filter @openforge-app/plugin-sdk build` | Passed including entrypoint and asset checks. |
| `pnpm --filter @openforge-app/plugin-sdk check:contract` | Passed packed token-only feedback/README rendering, mounted themes, motion, native ranges, and retry contracts. SDK tests also ran through the root suite. |
| `node scripts/check-terminal-presentation-themes.mjs` | Passed 12 theme/viewport cases, contributed-palette replacement, motion, and conformance chrome. |
| `node scripts/check-terminal-presentation-themes.mjs --production-css` | Same checks passed against production host CSS. |
| `node scripts/check-settings-themes.mjs` | Passed all 6 theme/viewport combinations, retaining existing stable-ID and contributed-theme regression coverage. |

## Inventories and remaining gaps

`scripts/terminal-ui-migration.test.mjs` scans both packages including tests and executable conformance, plus the routed host stylesheet. Actual legacy consumers are zero. Reviewed dynamic spreads carry only identity/workspace/activity/callback props. Explicit candidate exceptions are native element/role names, input event names, and loading-state literals, not styling dependencies. The original global JSON ledger is a historical KVG-4863 snapshot; this bounded scan supersedes its terminal entries.

The root suite's 35 skips are existing opt-in coverage: 21 Storybook browser cases across creation, navigation, task schedules, branch divergence, Focus Board, Self Review, and Project Sidebar; 11 rich-Markdown visual cases; 2 interaction-overlay visual cases; and 1 terminal performance-overhead benchmark. Storybook services and the opt-in visual/performance flags were not enabled. The terminal theme browser checks, conformance raster checks, and settings regression ran independently and passed.

The pinned Linux Storybook screenshot matrix and live Electron/native-PTY races were not run. No Rust, mobile, or website code changed, so their standalone checks were not run. Browser transport simulation verifies the public session contract but is not evidence of a live native PTY/theme-switch test.

Follow-up KVG-5002 records existing duplicate unavailable/error announcements in the terminal task pane and project view, linked to KVG-4867 with `cleanup` and `bug` labels. Those branches remain outside this loading migration.
