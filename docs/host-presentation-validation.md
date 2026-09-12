# KVG-4873 remaining host presentation

## Scope

Board loading and merge feedback, shell palettes and dialogs, shared context menus, prompt suggestions, toast loading, voice transcription loading, model-download feedback, and host content/status CSS now use SDK feedback controls or OpenForge tokens. Settings changes are limited to the existing loading indicators in `SettingsView` and `ProviderSelectField`. Their controllers, provider selection, autosave, and forms are unchanged.

The download progress bar now has the accessible name `Downloading Whisper <model>`. Its percentages, byte text, retry action, completion callback, and existing non-live policy remain intact. Toasts keep caller-owned urgency, actions, timing, and card geometry; their loading glyph uses the SDK indicator at the existing 17px size. The SDK ring replaces the old spinner drawing, not its foreground color or layout bounds.

The adapter, daisyUI dependency, stable theme IDs, SDK exports, plugin-owned CSS, and terminal lifecycle are unchanged. Font, border, radius, and control-size behavior remains token-driven. Existing hard-coded content geometry was preserved rather than redesigned.

## Consumer inventory

`pnpm exec vitest run scripts/check-host-presentation-inventory.test.mjs` uses the existing parser-backed inventory, not a competing lexical scan. It rejects remaining host color/control/variable dependencies and parse failures outside the explicitly owned pending batches. It includes executable host fixtures except the transitional settings compatibility fixture.

A supplemental review found that the scanner did not recognize daisyUI keyboard hints. A failing regression test demonstrated the omission. The scanner now recognizes `kbd` and its size classes without mistaking a native `<kbd>` element for a dependency. Host keyboard hints use `src/styles/keyboard-hints.css` and native markup. Their styles remain below utilities so caller paint overrides still work. `AddTaskDialog` needed only this bounded presentation change.

The scoped inventory is clear. The full repository inventory is deliberately not zero while these native backlog tickets remain open:

| Owner | Retained consumers |
| --- | --- |
| KVG-4871 | Project setup and attention, including attention keyboard hints |
| KVG-4872 | Task-detail/self-review, `shared/pr/PrCommentsList`, `shared/pr/PrPipelineChecks`, `shared/tasks/TaskRelationshipDetailSection`, Storybook `StatusFrame` and `TaskPaneFrame`, task-detail keyboard hints |
| KVG-4867 | Terminal presentation, including `src/styles/terminal-presentation.css` and terminal-runtime keyboard hints |
| KVG-4866 | PR review package, including `InlineCommentForm` keyboard hints |
| KVG-4865 | SDK consumers and Storybook `SdkOverlays` / `SdkWorkspace` fixtures |
| KVG-4868 | GitHub sync and its `GitHubSyncCardFrame` |
| KVG-4869 | File viewer and its `FileViewerModule` frame |
| KVG-4870 | Task browser |
| KVG-4874 | Adapter/build dependency and transitional settings compatibility probes |

Newly confirmed paths were appended to the owning, never-started task prompts through the OpenForge CLI. No dependencies were changed and no task was started. KVG-4687 was not modified.

### Dynamic-expression review

The scanner still reports expressions requiring manual review. The changed-file review covered all 18 records: three scanner implementation expressions and 15 renderer expressions. These are local layout classes, toast variant suffixes, plugin-owned `renderProps`, prompt layout class props, context-menu derived classes, and palette class callbacks. Their literal color branches now use semantic tokens, and first-party callers were scanned. Plugin-provided styling remains plugin-owned. These records are reviewed expressions, not a claim that the parser resolves arbitrary callbacks.

## Validation

The affected subsystem is the host renderer and its shared stylesheet, plus executable Storybook fixtures and the inventory checker. Validation covers all host-source tests, the Node test project, host lint/build, bundled-plugin builds, both Storybook builds, and browser paint/geometry. No package implementation, IPC, database, Rust, mobile, or website code changed.

| Command | Result |
| --- | --- |
| `pnpm i` | Passed; skipped dependency build scripts for `@vgpu/adapter-node`, `esbuild`, and `webgpu` |
| `pnpm exec vitest run $(rg --files src --glob '*.test.ts')` | Passed: 427 suites, 3,854 tests; one visual suite with two tests skipped |
| `pnpm exec vitest run --project node` | Passed: 92 suites, 740 tests |
| Focused host/component, settings, theme-contract and inventory suites | Passed: 85 suites, 841 tests; two visual tests skipped |
| `pnpm lint` | Passed, including the existing geometry inventory and refreshed exceptions |
| `pnpm build` | Passed; existing large-chunk warning |
| `pnpm build:plugins` | Passed |
| `pnpm storybook:build` | Passed for pages and components |
| `node scripts/check-settings-themes.mjs` | Passed: six theme/viewport cases, preserving selection, focus and edited input |
| `node scripts/check-settings-themes.mjs --compatibility-only` | Passed: seven compatibility cases, including contributed-theme mutation |
| `STORYBOOK_URL=http://localhost:6143 node scripts/check-host-presentation.mjs` | Passed: 60 before/after paint and geometry cases |
| Same command with `HOST_PRESENTATION_BASELINE=artifacts/storybook-visual/host-presentation/keyboard-before.json` | Passed: 60 keyboard-hint baseline cases |
| `STORYBOOK_URL=http://localhost:6143 node scripts/check-host-feedback.mjs` | Passed under six themes at 1280px and 360px, plus a new contributed palette/geometry |
| Same feedback command with `--production-css` | Passed using built host CSS instead of development styles |

Before/after measurements use the same Chromium, loaded fonts, a one-CSS-pixel geometry tolerance, and 1280px/1000px desktop viewports. They cover settings loading/saving, action and command palettes, and the focus board. A separate keyboard baseline was captured before replacing the newly discovered keyboard classes. The feedback browser check covers native progress semantics, one polite toast announcement, decorative loading, hover/pressed/focus-visible/disabled states, reduced and normal motion, narrow wrapping, content paint, and token changes without remounting.

The download naming test failed before implementation because the native progress bar had no name. Progress events, retry, completion, and provider loading/focus have public-interface coverage. Existing action and settings suites remain unchanged except for the added feedback assertions.

### Failures and gaps

- The first complete `pnpm test` run finished with 804 passing suites and two failures. One was a stale geometry exception, since fixed and verified. The other was `packages/plugin-sdk/src/ui/Switch.test.ts`, `lets a quick flick commit in its travel direction`. That failure reproduced in isolation and already has tasks KVG-4983 and KVG-4990. No SDK code was changed or duplicate task created.
- Later whole-workspace retries exceeded their execution windows. A reduced-worker retry and broad renderer retries also timed out. These are not counted as passes. The final explicit host-source run and separate Node run completed successfully.
- The opt-in `InteractionOverlays.visual.test.ts` raster suite was not enabled. The new browser measurements and screenshots passed, but the Docker-pinned Storybook raster comparison was not run.
- Package-specific publication/conformance suites and individual plugin test/static-check scripts were not rerun separately. No package implementation changed; the initial workspace run exercised their first-level suites, and final host/plugin builds and production-CSS browser checks passed. Final dependency removal and its repository-wide validation remain KVG-4874.
- The production feedback check uses production CSS on real host components in the Storybook browser, not an installed Electron end-to-end session.

## Evidence and reproduction

Logs are in `artifacts/storybook-visual/host-checks/`. Measurements and screenshots are in `host-presentation/`, `host-feedback/`, `host-feedback-production/`, `host-settings/`, and `host-settings-compatibility/` beneath `artifacts/storybook-visual/`. These are local validation artifacts, not updated raster baselines.

Start the pages catalog for this worktree with `pnpm exec storybook dev -p 6143 -c storybook/pages --ci --no-open`. For a future presentation change, run `check-host-presentation.mjs --capture` before editing, then run without `--capture` after editing. Set `HOST_PRESENTATION_BASELINE` to keep a separate baseline for an additional batch. The original KVG-4873 color baseline is `before.json`; the keyboard baseline is `keyboard-before.json`.

No new cleanup tasks were needed. Existing Switch timing tasks remain the outstanding whole-workspace test issue.
