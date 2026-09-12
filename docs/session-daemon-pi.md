# Controlled live Pi preservation

KVG-4720 extends the [controlled daemon path](session-daemon-shell.md) to one Pi Task. The owner approved keeping this debug/E2E-only. Normal production launches and other providers retain their existing adapters. This does not enable Restart, packaged updates, or live daemon replacement.

## Activation and ownership

Set `OPENFORGE_E2E=1`, `OPENFORGE_SESSION_DAEMON_ROOT`, and `OPENFORGE_SESSION_DAEMON_PATH` as described in the shell guide. Set `OPENFORGE_SESSION_DAEMON_PI_KEY` to one exact Task ID. Pi does not accept `*`. The optional shell selector remains independent, and both selections share one controller connection.

Pi still starts through the existing provider and `start_implementation` interfaces. The Sidecar prepares the provider command, working directory, environment, extension, and terminal-image selection. The daemon allocates the PTY, injects its allocation instance and stable agent capability, and owns the process tree. It removes the Sidecar controller token before launch. There is no Sidecar PID file for this allocation.

Replacing the Sidecar does not stop Pi. Startup consults the selected Pi allocation before checking workspace paths or invoking history recovery. A live allocation protects only the matching database PTY instance from startup interruption. Unrelated stale rows are still interrupted. Retained exits also suppress history recovery, so a completed process is not silently relaunched. Failure to read daemon inventory degrades startup rather than falling back to a duplicate launch.

The existing notification gateway delivers accepted completion and permission events to the replacement Sidecar. The retained Pi allocation bypasses history recovery while those events restore its existing Agent Session. Reconnection does not approve permissions. Unmatched database metadata is not guessed or reassigned to a different allocation.

Existing terminal commands, backend follow-up input, resize, scoped stop, completed replay capture, and process-memory diagnostics use the daemon for the selected Pi Task. Fenced terminal requests reject stale controller or PTY identities. Retained terminal output remains readable after exit.

The controlled bridge retains the shell path's allocation limits and refusal to replace a retained exited key through spawn. This slice preserves an existing allocation; it does not introduce a general production policy for recycling allocations or normal Quit.

## Deterministic tests

```sh
node scripts/session-daemon-contract.mjs
```

The contract runner now includes the Pi `start_implementation` test and real-process Sidecar replacement fixture. Together they cover:

- Launch through the existing interface and daemon-assigned environment identity.
- Backend buffer, input, resize, stop, and PID lookup after controller replacement.
- Startup with a moved working directory and an unrelated stale database allocation.
- Unchanged fixture and running tool PIDs through two actual Sidecar replacements.
- Completion and permission notifications accepted during downtime.
- Fresh input, geometry, and CLI requests after each replacement, with numbered responses to reject stale replay as evidence.
- One provider invocation, stale-controller rejection, process diagnostics, retained output, and no history resume after an exit.

The fixture executable is deliberately not the installed Pi binary. The live-provider test below is separate. Without explicit credential opt-in, the combined runner prints that it skipped the live-provider demonstration.

## Installed Pi demonstration

The opt-in test copies credentials into a private temporary HOME, preserves the supplied default provider/model/thinking settings, and does not load the user's packages or extensions. It launches the installed Pi through OpenForge, asks for one bash tool with a 20-second wait, replaces the Sidecar while that tool runs, and waits for the original turn to complete. The same tool invokes the refreshed OpenForge CLI after replacement. Fixture cleanup stops only the owned processes and removes the isolated data and copied credentials.

```sh
OPENFORGE_LIVE_PI_AUTH="$HOME/.pi/agent/auth.json" \
OPENFORGE_LIVE_PI_SETTINGS="$HOME/.pi/agent/settings.json" \
cargo test --manifest-path "$(node scripts/rust-sidecar-layout.mjs manifest-path)" \
  --test session_daemon_sidecar installed_pi_preserves -- --ignored --nocapture
```

The final macOS arm64 demonstration passed using the supplied `openai-codex` / `gpt-6-astra` defaults. Pi PID 28738, bash-tool PID 28877, and PTY instance 71675734822523 survived Sidecar 28732 being replaced by 28880. The original turn completed and its CLI call succeeded. These are one run's identifiers, not fixture constants. Evidence is in `/tmp/KVG-4720-live-pi-final.log`.

## Validation

The complete affected backend, desktop, and Terminal Runtime checks passed:

- Backend `cargo test`: 2,054 unit tests plus four non-ignored integration tests. Its ignored daemon tests run separately through the contract command.
- Session host/protocol/client/daemon tests and the combined daemon contract runner.
- `cargo check`, `cargo build`, `cargo clippy`, and formatting checks for the backend and all four session crates.
- Root `pnpm test`: 808 files and 6,786 tests passed, with the suite's existing skips and expected failures.
- `pnpm exec tsc --noEmit`, `pnpm lint`, Electron IPC and Companion contracts.
- Terminal Runtime tests: 250 passed and one skipped; build/type checks and presentation conformance passed.

Final logs use `/tmp/KVG-4720-final-*.log`. Terminal presentation evidence is in `artifacts/terminal-presentation/report.json`. TDD failure logs are `/tmp/KVG-4720-red*.log`.

The installed-provider demonstration ran on macOS arm64, not x64. No headed Electron restart, packaged update, live daemon reexec, or production enablement is claimed. Other providers were exercised by their existing backend and hook suites rather than migrated. Cleanup task KVG-4998 tracks separating connection/event handling from the growing shared daemon bridge.
