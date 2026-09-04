## 1. Characterize Pi lifecycle behavior

- [x] 1.1 Replace the Pi extension source-presence assertions with a reusable Node event-bus harness that captures lifecycle requests, and verify the existing ordinary input, start, and settled completion flow with `cargo test pi_extension`.
- [x] 1.2 Add failing lifecycle tests for one and several session-owned async runs, out-of-order completions, an unrelated session, a stale completion after session replacement, and a final completion that races a parent wake; verify each scenario fails for the expected missing behavior before implementation.
- [x] 1.3 Add failing recovery tests using temporary versioned `status.json` artifacts for active, terminal, wrong-session, malformed, missing, and unreadable runs; verify recovery is bounded to candidates recorded in the current Pi session entries.

## 2. Track session-owned background work

- [x] 2.1 Add bounded payload parsing and an in-memory run tracker to the bundled Pi extension, subscribe it to the documented async start and completion channels, and verify tests accept only exact current-session ownership and valid run identities.
- [x] 2.2 Move final Pi completion reporting from `agent_end` to `agent_settled`, report `became_busy` while tracked work remains, and report `ended` only when parent settlement and background-work state agree; verify ordinary retry, continuation, and no-subagent tests pass.
- [x] 2.3 Handle the last-child completion by checking Pi idle state before reporting `ended`, and reconcile terminal status without discarding live observed work on read failure; verify wakeup-race and missing-completion tests pass.
- [x] 2.4 Restore active runs on startup, reload, and resume from current-session subagent tool results and their exact lifecycle artifacts, dispose event subscriptions during session shutdown, and verify recovery and stale-session tests pass.

## 3. Validate the affected system

- [x] 3.1 Run the focused Pi extension suite from `src-tauri` with `cargo test pi_extension` and confirm every scenario in `specs/pi-background-work/spec.md` maps to an automated test or an explicitly recorded manual check.
- [x] 3.2 Run the backend crate's full validation from `src-tauri` with `cargo fmt -- --check`, `cargo test`, `cargo clippy`, and `cargo check`, and record any skipped or failing check with its cause.
- [x] 3.3 Drive the desktop app with a real Pi Task that launches an asynchronous subagent, confirm the Agent Session stays running after the parent settles and while the child works, then confirm it completes only after the child result and resumed parent turn settle.
- [x] 3.4 Reload or resume the same Pi session while an asynchronous subagent is active and confirm OpenForge restores the running state without attributing work from another session.
