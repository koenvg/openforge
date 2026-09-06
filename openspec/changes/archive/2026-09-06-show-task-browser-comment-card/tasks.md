## 1. Current-page comment card

- [x] 1.1 Add a failing page-script test for singular and plural counts, ascending annotation order, exact comment text, semantic labelling, and no card for an empty collection; then implement the minimal lower-right card renderer and verify `pnpm test src/electron/taskBrowserVisualFeedbackOverlay.test.ts` passes.
- [x] 1.2 Add a failing controller integration test proving that navigation and replacement show only annotations for the exact visible URL; then wire the card to the existing URL-grouped marker input and verify `pnpm test src/electron/taskBrowserVisualFeedback.test.ts` passes.

## 2. Disclosure and arbitrary-page resilience

- [x] 2.1 Add a failing page-script test for initial expansion, keyboard collapse and reopen, `aria-expanded`, compact count text, and same-URL disclosure preservation; then implement local disclosure state and verify the focused overlay test passes.
- [x] 2.2 Add a failing page-script test for page-style isolation, viewport-bounded dimensions, overflow handling, click-through prevention inside the visible card, and contained site events; then implement the shared-theme styling and root-scoped event cleanup and verify the focused overlay test passes.

## 3. Selection, capture, and cleanup lifecycle

- [x] 3.1 Add failing selection tests for hiding the card during region selection, restoring it after cancellation, and immediately including a saved comment; then implement selection lifecycle integration and verify `pnpm test src/electron/taskBrowserVisualFeedbackOverlay.test.ts` passes.
- [x] 3.2 Add or extend integration tests for removing the card with the last marker, restoring it after navigation, and excluding it from visible-viewport captures; then reuse the existing annotation-root teardown and visibility path and verify `pnpm test src/electron/taskBrowserVisualFeedback.test.ts src/electron/taskBrowserSurfaceElectronAdapter.test.ts` passes.
- [x] 3.3 Update `plugins/task-browser/README.md` to describe the current-page comment card and the existing plugin-owned review actions, then verify the documentation matches the implemented behavior and introduces no new SDK capability claim.

## 4. Affected-system verification

- [x] 4.1 Run `pnpm test src/electron/taskBrowserVisualFeedbackOverlay.test.ts src/electron/taskBrowserVisualFeedback.test.ts src/electron/taskBrowserSurfaceElectronAdapter.test.ts` and verify all focused Task Browser visual-feedback tests pass.
- [x] 4.2 Run `pnpm exec tsc --noEmit -p tsconfig.electron.json`, `pnpm lint`, and `pnpm electron:build`; verify Electron TypeScript, repository static checks, generated contracts, and the desktop bundle complete without errors.
- [x] 4.3 Run the impacted broader suite with `pnpm test` and verify no Electron, renderer, package, or built-in plugin regression appears.

## 5. Theme, deletion, and selection corrections

- [x] 5.1 Add a failing page-script regression test proving the complete card and descendants leave rendering, hit testing, and accessibility exposure during selection; replace inherited visibility concealment with full display removal and verify `pnpm test src/electron/taskBrowserVisualFeedbackOverlay.test.ts` passes.
- [x] 5.2 Add failing Plugin SDK, renderer bridge, native contract, and controller tests for optional light/dark visual-feedback presentation; implement the additive typed synchronization input and verify the affected contract tests pass.
- [x] 5.3 Add failing overlay and Task Browser plugin tests for light and dark palettes plus live configured-theme changes; implement palette rendering and plugin theme observation without changing disclosure state, then verify the focused overlay and plugin tests pass.
- [x] 5.4 Add failing page-script tests for labelled keyboard-operable delete controls, trusted user action delivery, untrusted page-event rejection, and pending-row retention; implement the card-side delete request and verify the focused overlay tests pass.
- [x] 5.5 Add failing Electron controller, manager, boot adapter, and renderer bridge tests for typed delete-action routing with surface generation, exact-URL, and annotation validation; implement the additive host-to-plugin event and verify all affected routing tests pass.
- [x] 5.6 Add failing Task Browser plugin tests proving an in-card delete request uses the existing authoritative deletion, persistence, capture cleanup, undo, error recovery, and marker synchronization path; implement the subscription and verify `pnpm test plugins/task-browser/src/TaskBrowserTab.test.ts` passes.
- [x] 5.7 Update `plugins/task-browser/README.md` and Browser Surface SDK documentation for configured appearance and in-card deletion, then verify the text matches the implemented ownership and security behavior.

## 6. Revised affected-system verification

- [x] 6.1 Run focused Plugin SDK, Electron visual-feedback, renderer bridge, and Task Browser plugin tests and verify every new theme, deletion, and selection scenario passes.
- [x] 6.2 Run Plugin SDK contract checks, Electron TypeScript, repository lint, plugin builds, and `pnpm electron:build`; verify generated contracts and all affected subsystem static checks complete without errors.
- [x] 6.3 Run `pnpm test` and verify no Electron, renderer, package, or built-in plugin regression appears after the expanded change.
- [ ] 6.4 Launch `pnpm electron:dev` and manually verify both configured themes, row deletion and failure recovery, expanded and collapsed states, long and multiple comments, exact-URL navigation, constrained layout, complete selection concealment, keyboard focus, and capture exclusion; record any remaining gap.
  - Launch smoke check reached a ready Vite dev server and built the Task Browser plugin. Manual interaction remains blocked in this environment because macOS denies screen capture and Apple Events automation; theme, deletion, focus, layout, navigation, and capture scenarios remain a user-visible verification gap.
- [x] 6.5 Run the required fresh-context code review against the completed diff, resolve or report every finding, and verify the final focused checks remain green.
  - Resolved all three merge blockers: viewport capture now uses complete DOM removal with a lifecycle regression test, delete activation is captured in an Electron isolated world, and failed deletion persistence or synchronization restores the authoritative draft and live markers. Final plugin, Electron/renderer, TypeScript, build, and lint checks pass.
