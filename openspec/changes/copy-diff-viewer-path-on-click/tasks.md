## 1. Shared Diff Viewer Behavior

- [x] 1.1 Add failing focused component tests for pointer activation, keyboard-accessible naming, current-path selection for renamed files, and unchanged expanded/collapsed state; verify the focused Vitest run fails for the missing path-copy behavior.
- [x] 1.2 Add and thread an `onCopyFilePath` callback through the shared Diff Viewer section components, split the collapse and current-path controls in the file header, and verify the focused shared-component tests pass.

## 2. Desktop Clipboard Integration

- [x] 2.1 Add a failing app-level Diff Viewer test that activates a file-path copy control and expects the typed `writeClipboardText()` wrapper to receive the exact repository-relative path; verify it fails before adapter wiring.
- [x] 2.2 Wire the app Diff Viewer wrapper to the existing typed clipboard IPC function and verify the focused app-level test passes without any direct Electron or browser Clipboard API usage.

## 3. Validation

- [x] 3.1 Run the focused Diff Viewer test files covering the shared header and app adapter and verify all copy, collapse, rename, and existing header-interaction cases pass.
- [x] 3.2 Run `pnpm --filter @openforge-app/pr-review-ui check`, `pnpm lint`, and `pnpm build`; verify the affected shared package and renderer pass static and build validation.
