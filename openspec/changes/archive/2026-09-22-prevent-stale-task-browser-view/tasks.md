## 1. Lock down the lifecycle contract

- [x] 1.1 Add a failing regression in `src/lib/plugin/taskBrowserSurfaces.test.ts` that holds a bounds update open, starts attachment disposal, and verifies the detach request starts before the held update resolves and no later update restores the retired presentation.
- [x] 1.2 Extend `src/electron/taskBrowserSurfaceManager.test.ts` to verify same-generation updates after detach, older-generation updates after replacement, and window-bound replays cannot reattach or alter a retired presentation.
- [x] 1.3 Add a manager lifecycle regression that remounts Task Browser around both unrelated plugin destruction orders and returns to the same retained surface without destroy, session reset, navigation, reload, or renderer replacement; verify the real settings contributions, full application shell, retained page state, and absence of extra loading through the isolated desktop scenario in task 3.3.

## 2. Retire stale presentation without reloading

- [x] 2.1 Change renderer attachment disposal to mark the attachment retired, stop all DOM observers and animation tracking, and initiate host detachment before awaiting queued bounds work; verify task 1.1 passes without adding timing delays.
- [x] 2.2 Tighten main-process attachment ownership only if the manager regressions expose a gap, keeping attachment ID and generation checks authoritative; verify all task 1.2 race orders pass.
- [x] 2.3 Confirm disposal remains awaitable and preserves existing cleanup error behavior while retained surfaces continue through the existing `getOrCreate` path; verify task 1.3 and existing Task Browser teardown tests pass.

## 3. Regression and system verification

- [x] 3.1 Run the focused lifecycle suites with `pnpm test src/lib/plugin/taskBrowserSurfaces.test.ts src/electron/taskBrowserSurfaceManager.test.ts src/electron/taskBrowserSurfaceManager.lifecycle.test.ts` and `pnpm --filter @openforge-app/plugin-task-browser test`; verify every attachment, retention, and Task Browser test passes.
- [x] 3.2 Run full affected-system checks with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, `pnpm electron:build`, `pnpm --filter @openforge-app/plugin-task-browser typecheck`, and `pnpm --filter @openforge-app/plugin-task-browser build:bundle`; verify no renderer, Electron, plugin, or contract regression.
- [x] 3.3 Reproduce the original path in an isolated development profile by using Task Browser, opening Project Settings, disabling Handoff Notes Workflow, and returning to Task Browser; verify the application no longer jumps to a blank lower region, Settings stays fully visible and interactive, and the browser page returns without a reload or loading step. Repeat the toggle with another plugin to confirm the result does not depend on plugin teardown timing.
