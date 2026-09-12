# Task-detail styling migration validation

KVG-4872 implements the host slice in `openspec/changes/remove-daisyui/tasks.md` section 8.3. The checkout started at `88922186d`. Native prerequisites KVG-4687 and KVG-4864 were already done; neither task was modified.

## Scope

Migrated host task-detail and self-review colors, repository preview feedback, provider loading, and agent terminal-shell presentation. Included the routed host PR comments, pipeline checks, task relationships, and two Storybook frames. SDK imports use the already-published `Alert` and `LoadingIndicator` controls. Existing roles and live regions remain caller-owned; indicators accompanying existing messages are decorative.

Domain code, task actions, session ownership, lifecycle effects, terminal-runtime internals, shared review package internals, settings business logic, SDK exports, theme IDs, tokens, plugin-owned CSS, and compatibility styles are unchanged. Geometry allowlist contexts were updated without widening their exceptions.

This checkout does not contain the routed keyboard-hint stylesheet or scanner extension. The native task editor `kbd` instead uses scoped token styling. It preserves the original 16px bounds, half-em padding, token radius, and thicker bottom border. Browser comparisons cover this against the retained legacy styling in all six themes. Other host hints are not changed.

## Test boundaries and red/green evidence

The user confirmed testing rendered actions, edited values, selected/expanded state, accessible feedback, and mounted theme-aware diff/terminal rendering.

- Before changing presentation, captured 60 browser cases: five task-detail/self-review stories at 1280px and 1000px, each under four built-ins, Ink, and Copper. Chromium, fonts, locale, timezone, scale, and reduced-motion settings are held constant. Unchanged bounds have a maximum 1 CSS-pixel tolerance.
- The new browser check first failed because changing the legacy aliases turned the loading diff panel magenta. It passes after migration without those aliases affecting the measured host paint.
- The consumer inventory regression first failed on the routed PR, relationship, and frame classes. It now passes. Script-held classes are scanned; the 20 unresolved occurrences have explicit reviewed expressions. New unresolved expressions and parse errors fail the test.
- Existing focused suites verify provider failure/fallback, loading/error/retry, review feedback and selection, file/commit navigation, saved panes, keyboard actions, task editing, and terminal ownership behavior.
- Mounted browser checks preserve unsaved title text and focus, selected controls, rendered diff content, terminal DOM, session keys, and replay contents. A contributed palette is disposed and re-registered with changed tokens through the theme registry. The mounted diff adopts the new surface color. Reduced-motion loaders remain visible and decorative.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm i` | Passed. Lockfile unchanged. pnpm reported ignored optional build scripts for vgpu adapter, esbuild, and webgpu. |
| `pnpm exec vitest run src/components/task-detail/SelfReviewView.nonApplicationFiltering.test.ts src/components/task-detail/SelfReviewView.reviewedFileSnapshots.test.ts` | 7 tests passed during the first slice. |
| `pnpm exec vitest run src/components/task-detail src/components/shared/pr src/components/shared/tasks scripts/task-detail-ui-migration.test.mjs --maxWorkers=4` | 478 behavior tests passed; the new inventory test caught one remaining success class. That class was migrated, and the inventory passed separately and in the full suite. |
| `pnpm exec vitest run scripts/task-detail-ui-migration.test.mjs scripts/check-ui-migration-inventory.test.mjs` | 28 tests passed after the final visibility assertion was tightened. |
| `pnpm test --maxWorkers=4` | Final run: 809 files passed, 9 skipped; 6,787 tests passed, 3 expected failures, 35 skipped. |
| `pnpm lint` | Passed, including unused imports, plugin boundaries, and the migration checker over 849 files. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm exec tsc -p storybook/tsconfig.json --noEmit` | Passed after the user requested fixing both existing browser-test nullability errors in this task. The diagnostic accepts `undefined`, and the empty-text assertion still fails for null content. |
| `pnpm build` | Passed. Existing large-chunk warnings remain. |
| `STORYBOOK_URL=http://localhost:6012 node scripts/check-task-detail-themes.mjs --capture` | Captured the 60 pre-migration cases. |
| `STORYBOOK_URL=http://localhost:6012 node scripts/check-task-detail-themes.mjs` | Passed all 60 comparisons plus mounted-state, palette-reload, loading semantics, and keyboard-hint checks. |
| `STORYBOOK_URL=http://localhost:6012 pnpm exec vitest run storybook/stories/pages/SelfReview.browser.test.ts` | 8 browser tests passed, including narrow layouts, keyboard navigation, feedback sending, and saved panel widths. |
| `STORYBOOK_URL=http://localhost:6012 pnpm exec vitest run storybook/stories/pages/BranchDivergence.browser.test.ts storybook/stories/pages/SelfReview.browser.test.ts` | 11 tests passed after the nullability fixes. |
| `node scripts/check-settings-themes.mjs` | Passed all 6 existing theme/viewport combinations, including stable IDs and edited values. |
| `pnpm storybook:visual:check` before baseline update | 458 of 463 passed; five loading-state images changed. |
| `pnpm storybook:visual:update` | All 463 captures passed. Exactly five tracked images changed. |
| `pnpm storybook:visual:check` after update | All 463 production Storybook comparisons passed in the pinned Linux environment. No tolerance changes. |
| `git diff --check` | Passed. |

The final full suite, browser matrix, lint, and TypeScript checks were rerun after the regression scripts settled. Both production Storybook catalogs were built by the visual workflow. Component scripts were also compared against the starting revision after normalizing only added SDK imports and semantic class strings; no other script changes were found.

## Screenshot review

The changed baselines are Self Review Loading in light/dark, Agent Panel Starting, Diff Loading, and Repository Preview Loading. They replace the daisyUI masked spinner with the published SDK border spinner. Bounds and inherited ink remain unchanged. The full-page loading captures also change rasterization of the translucent Scope subtitle: computed color, opacity, background, and font remain identical, while the light capture changes from grayscale to subpixel antialiasing. No other tracked screenshots changed. The new baselines were inspected and passed a fresh full canonical comparison.

## Artifacts and reproduction

- `artifacts/task-detail-themes/before.json` and `after.json`: local computed measurements.
- `artifacts/storybook-visual/index.html`, `results.json`, and `environment.json`: pinned production screenshot results.
- Five updated images under `storybook/baselines`: tracked visual evidence.

Start a pages Storybook from the intended worktree with `pnpm exec storybook dev -p 6012 -c storybook/pages --ci`. The native measurement check needs a pre-migration capture from the base revision using the same browser and fonts. `TASK_DETAIL_BASELINE` can point to that capture when comparing a different worktree. Do not capture the migrated implementation over the original measurements to hide a mismatch. The legacy keyboard comparison and alias-poison probes are transitional and belong to the final removal ticket once the adapter is removed.

## Skips and gaps

- The user expanded scope to include the two Storybook browser-test nullability fixes. The separate Storybook typecheck now passes. Both affected browser suites passed together, 11 tests, and the full suite, host typecheck, and lint were rerun successfully. Production builds and screenshot checks were not repeated for these test-only edits.

- The root suite's environment-gated tests retain 9 skipped files and 35 skipped tests. The affected Self Review browser suite was additionally run with a live Storybook rather than counted as covered by those skips.
- The shared baseline cases still carry a KVG-4897 narrow-view exemption, but native task lookup returned 404 and the completed KVG-4777 covers the layout repair. Current measurements show visible, unclipped loading/error feedback in a 336px diff pane at 1000px. This task's new regression enforces visibility without that exemption. The shared baseline tooling was not changed here.
- The canonical repeated-capture self-test was not run. The full canonical comparison passed after baseline update.
- Rust, mobile, and website checks, SDK publication checks, separate plugin builds, and terminal-runtime conformance were not run. No implementation in those subsystems changed. Root tests include workspace suites, and host/Storybook builds exercise the unchanged SDK and shared packages as consumers.
- Deleted open follow-ups KVG-4995 and KVG-4999 at the user's request. Preserved the already-completed KVG-4991 history. Shared compatibility CSS remains for other migration tickets.
