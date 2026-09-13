# Implementation verification

The implementation and consumer audit are complete. Public test boundaries are SDK controls, packed SDK imports, rendered host/plugin behavior, and real browser interaction. No private tooltip-helper unit tests were added.

## Delivered behavior

- IconButton shows its effective accessible label by default; Button offers the user-approved opt-in API, defaulting off. Both accept side, alignment, and gap preferences.
- Shared composition retains native button identity, callbacks, accessible names/descriptions, disabled/loading semantics, and native submit defaults. Enabled tooltips suppress duplicate native titles.
- Tooltips portal outside clipping containers, wrap within the viewport, follow collision-adjusted placement, animate with a small overshoot, and respect reduced motion and theme tokens.
- Keyboard, pointer, and first-touch activation work without extra actions. Escape closes focused or hovered tooltips before their dialog. Tab releases the tooltip focus scope before dialog focus wrapping.
- Trigger attributes are captured while mounted, including initial server rendering, so tooltip teardown does not evaluate getters on disposed controllers. Renderer regressions reproduced and verified this fix.
- Initially controlled-open standalone tooltips retain their active trigger identity and correct placement.
- Host/plugin adoption, placement, retained shortcut information, and non-icon classifications are recorded in migration-inventory.md.

## Final affected-system checks

| Command / scope | Result |
| --- | --- |
| `pnpm exec vitest run --project renderer` | 640 files passed, 9 skipped; 5,455 tests passed, 35 skipped |
| `pnpm --filter @openforge-app/plugin-sdk test` | 72 files passed; 593 tests passed, 3 expected failures |
| `pnpm --filter @openforge-app/plugin-sdk build` | Passed, including runtime assets and entrypoint checks |
| `pnpm --filter @openforge-app/plugin-sdk check:entrypoints` | Passed explicitly |
| `pnpm --filter @openforge-app/plugin-sdk check:contract` | Passed: clean npm/Bun consumers, public declarations, SSR documentation and mounted rendering contracts |
| `pnpm exec tsc --noEmit` | Passed |
| `pnpm lint` | Passed: unused Svelte imports, plugin boundaries, UI migration inventory |
| `pnpm --filter @openforge-app/pr-review-ui check` | Passed |
| `pnpm --filter @openforge-app/terminal-runtime test` | 56 files passed; 250 tests passed, 1 skipped |
| `pnpm --filter @openforge-app/terminal-runtime build` | Passed |
| File viewer plugin tests | 17 files, 97 tests passed |
| GitHub sync plugin tests | 39 files, 398 tests passed |
| Task browser plugin tests | 5 files, 63 tests passed |
| Task schedules plugin tests | 11 files, 108 tests passed |
| Terminal plugin tests | 11 files, 47 tests passed |
| GitHub sync and task browser `typecheck` scripts | Passed |
| All five affected plugin `build:bundle` scripts | Passed |

Plugin tests and builds were serialized with:

```sh
pnpm --filter @openforge-app/plugin-file-viewer --filter @openforge-app/plugin-github-sync --filter @openforge-app/plugin-task-browser --filter @openforge-app/plugin-task-schedules --filter @openforge-app/plugin-terminal --workspace-concurrency=1 -r test
pnpm --filter @openforge-app/plugin-file-viewer --filter @openforge-app/plugin-github-sync --filter @openforge-app/plugin-task-browser --filter @openforge-app/plugin-task-schedules --filter @openforge-app/plugin-terminal --workspace-concurrency=1 -r build:bundle
pnpm --filter @openforge-app/plugin-github-sync --filter @openforge-app/plugin-task-browser --workspace-concurrency=1 -r typecheck
```

## Browser, stories, and visual evidence

- SDK suite includes 24 Chromium tooltip cases: preferred sides, alignment/gap, collision-flipped motion, clipping/wrapping, overshoot/settle, exit/reopen, delay/hoverable content, keyboard/touch dispatch, nested Escape, dialog Tab wrapping, reduced motion, and four built-in themes.
- `pnpm storybook:build` passed for both catalogs.
- `node scripts/storybook-tooltip-check.mjs` passed 25 checks with the built Storybook server active: six states in four themes plus first-touch activation. It checks narrow scrolling toolbars, keyboard/click counts, reduced motion, window edges, dialog/menu dismissal, and diagnostics. Native screenshots and results are in `artifacts/tooltips/browser/`.
- `STORYBOOK_URL=<served-pages-url> pnpm exec vitest run storybook/stories/pages/SelfReview.browser.test.ts` passed all eight tests against the built page catalog. This suite was run explicitly rather than treating its default skipped state as success.
- `pnpm storybook:coverage`, `pnpm storybook:coverage:test`, and `pnpm storybook:coverage:check` passed. Incremental inventory: 139 covered, one validated test-only exclusion, 129 uncovered, zero errors. The new visual module is covered; unrelated existing catalog gaps were not hidden.
- `pnpm storybook:visual:unit`: 13 files, 98 tests passed.
- Canonical Linux `pnpm storybook:visual:check` passed all 463 cases against the final production source. Evidence: `artifacts/storybook-visual/index.html`, `results.json`, `environment.json`, and `timings.json`.

### Reviewed visual differences

Three baseline images were intentionally updated through `pnpm storybook:visual:update`, then the full check passed:

1. Light split-button keyboard story now shows the menu trigger's tooltip.
2. Dark split-button keyboard story shows the same new tooltip.
3. Dark standalone-tooltip story retains its open tooltip with the new eight-pixel viewport collision gutter.

The before/after images were inspected. Control geometry and focus rings are unchanged. An earlier capture missing the standalone tooltip was rejected and the controlled-trigger initialization was fixed before approval. Native story review also caught a heading overlap in the new demonstration layout; spacing was corrected.

### TypeUI comparison

The TypeUI Overshoot card was opened in Chromium and its screenshot inspected. Its observed entrance uses a longer spring-like movement (roughly eight pixels, with a roughly 900 ms opacity animation). The implementation deliberately retains the approved restrained desktop tuning: 200 ms entry, 0.96 → 1.02 → 1 scale, a three-pixel directional start with small overshoot, and 100 ms exit. This is an adaptation of the reference, not a claim of identical spring timing. Native story review confirms readable labels, a small overshoot, and no trigger movement across all four themes.

## Scenario reconciliation

| Specification area | Evidence |
| --- | --- |
| Automatic labels, opt-out, live labels, descriptions | IconButton and Tooltip public component tests |
| Opt-in Button, unchanged identity/focus, native defaults | Button/IconButton public component tests and mixed-control renderer regressions |
| Placement, clipping, long labels | Tooltip Chromium suite; narrow/edge Storybook checks |
| Activation, Escape, focus wrapping, touch | Tooltip Chromium suite, ContextMenu compatibility, Storybook dialog/menu/keyboard/touch checks |
| Disabled/loading and removal | Public control tests, dialog teardown and PR review/host lifecycle regressions |
| Overshoot, exit/reopen, reduced motion, themes | Chromium animation assertions and four-theme Storybook review |
| Shared adoption and standalone/packed compatibility | Completed inventory, renderer/plugin suites, publication checks, standalone canonical capture |

## Scope and disclosed skips

Validation covers the SDK, renderer, PR review UI, terminal runtime, affected plugins, and Storybook. Backend/Rust, mobile, and website validation were not run because their code and contracts are unchanged. Existing optional renderer skips, the terminal-runtime skip, and SDK expected-failure cases are reported above, not counted as passes. The eight Self Review browser cases were subsequently exercised explicitly.

The full visual-runner self-test/repeated-capture command was not rerun: the runner itself is unchanged; its 98 unit tests and the complete canonical screenshot check passed. No baseline tolerance, runtime delay, or production behavior was weakened to obtain a pass. No independent cleanup task was needed; integration failures found here were fixed within this change.
