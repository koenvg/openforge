## 1. Atomic removal and desktop contract

- [x] 1.1 Add failing persistence tests for removing one directed relationship, preserving tasks and unrelated concurrent additions, idempotent absent-edge removal, a deleted prerequisite, and a missing current task; verify the tests fail for missing removal behavior before implementation.
- [x] 1.2 Implement transactional single-relationship removal using existing task validation and persistence conventions; verify all tests from 1.1 pass without changing full-list replacement or task-start behavior.
- [x] 1.3 Add failing command and renderer contract tests for camelCase task/dependency IDs, success, backend errors, and task-change notification after commit; implement the registered sidecar command and typed wrapper exported through src/lib/ipc.ts, then verify command registration and desktop IPC contract tests pass.

## 2. Inline chip interaction

- [x] 2.1 Add failing shared-section component tests for manage mode, icon-only trash/confirm/cancel, one confirmation at a time, untouched Dependent tasks, and navigation without mutation; verify failures before implementing the interaction.
- [x] 2.2 Implement sibling navigation/action buttons inside each visual chip, an explicit management toggle, and stable reserved action slots with cancel replacing the trash position; verify 2.1 passes and the DOM has no nested buttons or visible chip-action text.
- [x] 2.3 Add failing input and accessibility tests, then implement cancel-first focus, Escape cancellation, task-specific labels and tooltips, visible focus, repeated-input guards, and reduced-motion-safe transitions; verify keyboard removal needs explicit confirm focus and mutation controls do not invoke navigation.
- [x] 2.4 Add failing lifetime tests, then implement reset on task change, section collapse, manage-mode exit, destruction, and disappearance of the confirming relationship; verify unsubmitted confirmation never carries to another task or reappears when the section reopens.

## 3. Mutation ownership and refresh

- [x] 3.1 Add failing TaskInfoPanel integration tests, then wire a focused task-scoped mutation owner through on-prefixed callbacks; verify a confirmed action sends exactly one request with the original task/dependency pair and disables section mutations while pending.
- [x] 3.2 Add failing error and navigation-race tests, then implement busy feedback, retained chips on persistence failure, fresh confirmation for retry, and captured-identity handling; verify completion or failure for a previous task does not change the newly viewed task's interaction state.
- [x] 3.3 Add failing reconciliation tests, then use canonical refresh and notification paths to update dependencies, waiting counts, readiness, and cached inverse relationships; verify cross-project and completed task views, out-of-order results, concurrent edits, and removal of the final dependency.
- [x] 3.4 Distinguish committed removal followed by refresh failure from persistence failure, with accessible feedback and a refresh-only retry; verify retry does not send another removal and no removal automatically starts a task.

## 4. Integrated verification

- [x] 4.1 Add and run a real-browser regression using the project's browser test setup for same-position double-click/double-tap, held Enter/Space, deliberate confirm, cancel, and navigation; verify zero removal requests from repeated trash input at normal and narrow widths with long labels and reduced motion.
- [x] 4.2 Run full affected renderer and Rust backend subsystem test and static-check scripts from CONTRIBUTING.md and current package/crate configuration, plus desktop IPC contract checks; record commands, results, scope, and any blocked or skipped checks. Include pnpm test and the backend cargo test suite where prescribed, and widen to another subsystem only if the complete implementation diff affects it.
- [x] 4.3 Validate the completed change against every scenario in specs/task-dependency-removal/spec.md, run openspec validate remove-task-dependencies-inline --strict, and update KVG-5026 Handoff Notes with user-facing results and genuine follow-up tasks; verify validation and the notes replacement succeed before handoff.
