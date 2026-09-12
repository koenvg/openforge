# Feedback controls validation, KVG-4864

## Scope

Implements remove-daisyui tasks 3.1–3.4 and 4.2 only. The task does not remove daisyUI, migrate Mermaid actions or settings business logic, change theme IDs/tokens, or modify parent task KVG-4687. The user confirmed these public test boundaries before implementation:

- LoadingIndicator, Alert, and Progress props, native behavior, and accessibility.
- PluginViewState props, callbacks, keyboard behavior, and announcements.
- Published token-only imports, mounted token updates, reduced motion, paint, and geometry.

SDK publication and canonical root aliases require SDK tests/build/entrypoint/packed contracts, host tests/static checks/build, and cross-package plugin builds. Task Schedules' loading assertion now observes the existing status message rather than naming the decorative spinner; its full plugin suite and build are included. Rust, mobile, website-specific builds, terminal conformance, and other subsystem-specific scripts are outside this presentation-only diff.

## Baseline and browser evidence

Before changing PluginViewState, Chromium measured the original host-styled loading/error/empty views under all four built-ins. Setup: 1000 × 1200 viewport, 16px root font, loaded Inter 400/500/600, reduced motion, and a 320 × 300 plugin viewport. The retained geometry regression uses the same setup without host CSS and a maximum one CSS-pixel tolerance.

| Error view element | Relative x / y | Width / height |
| --- | --- | --- |
| Issue badge | 127.75 / 81.75 | 64.484375 / 24.5 |
| Heading | 90.65625 / 118.25 | 138.671875 / 28 |
| Error message | 92.578125 / 158.25 | 134.84375 / 20 |
| Retry | 131.484375 / 190.25 | 57.03125 / 28 |

Original loading sizes were 14, 17.5, 21, and 24.5px with a 28px compact-height token. The single-line alert measured 46px high, with 20px line-height, 12px vertical padding, and 1px borders. Progress measured 8px high. These dimensions remain checked in the token-only browser contract. Spinner artwork is now a scoped current-color ring rather than an animated host image mask; its occupied bounds are unchanged.

`Feedback.browser.test.ts` tests all four built-ins plus `com.example.ink:ink` and a second contributed palette/geometry. The fixture changes tokens while controls remain mounted and retains edited input. A direct palette/size mutation prevents fixture-specific theme selectors from satisfying the test. It checks native progress ranges, actual fill pixels, omitted value, reduced motion, inherited loading color, all feedback variants, caller-owned CSS, and Enter/Space retry operation. The same contract runs against the production-built installed tarball with no workspace aliases, Tailwind, or daisyUI.

The SDK fixture owns only theme selection for its isolated page; it does not claim to exercise persisted application selection. The existing `check-settings-themes.mjs` covers that host path separately. Native pixel samples verify progress fill, not canonical screenshot baselines. Repository screenshot approval uses the pinned Storybook visual workflow.

## Validation results

- `pnpm i`: passed; dependency build-script approval warnings unchanged.
- Focused feedback, native-range, public-export, and PluginViewState tests: passed after recorded red tests.
- `pnpm --filter @openforge-app/plugin-sdk test`: passed, 69 files and 535 tests, plus 3 expected failures at the first clean full run. Subsequent added compatibility assertions are included in final verification.
- SDK `build`, `check:entrypoints`, and `check:contract`: passed. The publication contract installs clean npm and Bun consumers, checks extracted shipped prop types including rejected options, compiles the README example, and renders built feedback in Chromium.
- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and `pnpm build:plugins`: passed during implementation. Production build reports existing large-chunk warnings.
- Initial `pnpm test`: 798 files passed, 2 failed, 9 skipped. One Task Schedules assertion required the status-message update in this diff. Native media capture timed out and left dependent assertions failing; the capture suite passed in a targeted rerun. Two bounded full reruns exceeded their execution windows under host load, so they are not passing evidence.
- Before opening the draft PR, the final focused run passed: `pnpm --filter @openforge-app/plugin-sdk test src/ui/LoadingIndicator.test.ts src/ui/Alert.test.ts src/ui/Progress.test.ts src/ui/PluginViewState.test.ts src/ui/Feedback.browser.test.ts src/ui/publicUiExports.test.ts src/vite.test.ts`, 7 files and 31 tests. This includes fill-pixel and action-snippet assertions. `pnpm --filter @openforge-app/plugin-sdk check:contract` passed again against the final controls.
- The later `pnpm test --maxWorkers=2` ended unsuccessfully without a complete summary; its log includes inventory/coverage test failures under resource contention. It is not a passing full run.
- `pnpm storybook:visual:check` built both catalogs and passed manifest validation, then ended unsuccessfully during the baseline phase. Screenshot comparison remains unverified; no baselines were changed.
- `node scripts/check-settings-themes.mjs` and standalone Task Schedules test/build validation remain outstanding. Final full affected validation is incomplete.
- The attempted fresh review did not launch: `Host runtime does not provide required tool 'read' for agent 'delegate' for lazy skill loading.` No review run or verdict exists. The PR is draft, not a completion claim.

Local run logs and original measurements are under ignored `test-results/feedback/`. Canonical screenshot reports are under `artifacts/storybook-visual/`.

## Follow-up

KVG-4983 records the unchanged Switch quick-flick test intermittently failing under parallel load and passing on a subsequent complete SDK run. No Switch behavior was changed. Other migration batches retain their existing ownership and prerequisites.
