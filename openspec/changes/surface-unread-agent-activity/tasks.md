## 1. Persist unread Agent output

- [x] 1.1 Add migration and database tests for zero-default output and viewed revisions on Agent Sessions, implement the additive columns and row mapping, and verify with the focused Rust migration and Agent Session tests.
- [x] 1.2 Add failing Rust tests for completed, paused, failed, and interrupted transitions, duplicate stopped notifications, and repeated follow-up turns, then centralize revision increments across lifecycle, finalization, startup interruption, and other direct status-write paths; verify each focused lifecycle test passes.
- [x] 1.3 Add failing database tests for revision-scoped acknowledgement, including stale acknowledgements and acknowledgements for superseded sessions, implement the atomic acknowledgement operation, and verify with the focused Agent Session database tests.

## 2. Extend Task Attention contracts

- [x] 2.1 Add failing Rust projection tests for unread review-pending and CI-running Tasks moving to Focus, read Tasks falling back to their configured lane, actionable Tasks remaining in Focus after reading, and set-aside Tasks retaining Out of Focus with unread metadata; implement unread metadata and Focus membership in the backend projection, then verify with `cargo test task_attention` from the backend crate root.
- [x] 2.2 Add the Agent Session revision fields and Task Attention unread field to shared TypeScript contracts and adapter fixtures, then verify the Plugin SDK contract and affected fixture tests with `pnpm packages:contract:check` and focused Vitest runs.
- [x] 2.3 Add contract tests for a camelCase, revision-scoped mark-viewed desktop IPC command, implement the command and renderer wrapper, regenerate the desktop IPC registry, and verify with focused IPC tests plus `pnpm electron:contract:check`.

## 3. Acknowledge visible Agent output

- [x] 3.1 Add failing renderer controller tests covering Agent pane selection, terminal attachment readiness, document visibility, window focus, output arriving while visible, and deduplication of acknowledgements; implement the isolated acknowledgement controller and verify its focused Vitest suite.
- [x] 3.2 Integrate terminal-ready reporting and the acknowledgement controller into Task Detail so hidden Review, Terminal, and plugin panes do not mark output read, then verify with focused `TaskDetailView` and `AgentTerminalShell` tests.
- [x] 3.3 Refresh Agent Session and Task Attention state after a successful acknowledgement without allowing an older request to clear a newer revision, and verify focused renderer tests cover Focus-to-In-Flight movement and a Focus Task that remains actionable.

## 4. Present unread state

- [x] 4.1 Add failing Task card tests for a visible, text-bearing unread indicator and its accessible meaning, implement the card presentation without replacing workflow status or reason text, and verify the focused Focus Board presentation tests.
- [x] 4.2 Add failing Attention Overview tests for unread rows in Focus and Out of Focus, implement the matching indicator, and verify keyboard navigation and live refresh tests still pass.
- [x] 4.3 Add failing Task pane navigation tests for an unread Agent tab marker and accessible name while another pane is active, implement the marker without using color alone, and verify focused Task Detail navigation tests.
- [x] 4.4 Add count-refresh tests for unread output entering Focus and acknowledged output returning to In Flight, implement any required store or event refresh wiring, and verify board, sidebar, rail, and Attention Overview counts stay aligned.

## 5. Validate affected systems

- [x] 5.1 Run the full renderer and shared-package checks with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm packages:contract:check`; fix regressions and record any remaining coverage gap.
- [x] 5.2 From `$(node scripts/rust-sidecar-layout.mjs backend-crate-root)`, run `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; fix regressions and confirm migration, lifecycle, acknowledgement, and Task Attention coverage passes together.
