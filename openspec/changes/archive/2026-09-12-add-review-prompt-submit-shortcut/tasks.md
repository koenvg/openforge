## 1. Keyboard submission

- [x] 1.1 Add failing component tests for platform submit shortcuts from the textarea and another dialog control, covering Address and Analyze modes and exact edited draft submission; verify the new cases fail for missing shortcut behavior with `pnpm exec vitest run src/components/task-detail/SendToAgentPanel.test.ts`.
- [x] 1.2 Connect a dialog-local Modal keyboard handler to the existing confirm-send action using the project's platform convention; verify the shortcut tests pass and existing click-submission and comment-handling tests remain green.
- [x] 1.3 Add regression tests for empty and whitespace drafts, running and paused status changes after opening, composition, repeated events, extra Alt/Shift modifiers, ordinary Enter/Shift+Enter, closed/outside-dialog scope, and consumption of valid shortcuts even when blocked; adjust only the local handler as needed and verify the component suite passes.

## 2. Shortcut discoverability

- [x] 2.1 Add the visible platform-specific hint beside Send to agent while preserving the action label; verify component assertions show Command+Enter on macOS and Ctrl+Enter on Windows/Linux.
- [x] 2.2 Inspect the dialog in a running UI at typical and constrained widths, verify all footer controls remain visible, and check native Enter/Shift+Enter newlines plus shortcut submission; record the preview or manual-check evidence and any platform coverage gaps.

## 3. Validation and handoff

- [x] 3.1 Run the focused component suite and affected renderer static checks from current package scripts and CONTRIBUTING.md against the complete task diff; verify passing results, report skipped checks, and widen to full affected-system validation if shared, lifecycle, or contract code changes.
- [x] 3.2 Complete the required fresh-context review at a fixed diff, resolve or report findings, and rerun affected checks after fixes; verify review evidence and final validation results are recorded.
- [x] 3.3 Update task KVG-4943 Handoff Notes through the plugin commands with the delivered user-facing behavior, open questions, and any follow-up tasks; verify the replacement succeeds before returning control.
