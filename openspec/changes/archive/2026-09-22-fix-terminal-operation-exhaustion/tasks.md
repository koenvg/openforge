## 1. Reproduce the failure and establish regression coverage

- [x] 1.1 Capture read-only inventory capacity counters from the affected running instance if it remains available, without acquiring a replacement controller or restarting processes; record the observed exhausted budget or explicitly record why live confirmation is unavailable. Live confirmation unavailable: the sidecar inventory response omits capacity counters, and the public client's connect method acquires a new controller generation. No replacement controller was acquired and no production process was restarted.
- [x] 1.2 Add a failing session-host regression with a small receipt limit: acknowledged writes and resizes across multiple PTYs exceed ten windows, followed by a new spawn; verify failure on current code is lifetime receipt exhaustion rather than a live-session or geometry limit. Red checkpoint: operation 9 returned Capacity with an eight-receipt limit and two live PTYs. Green checkpoint: explicit ordered acknowledgements allow 176 I/O operations and a third spawn.
- [x] 1.3 Add failing lifecycle-only and byte-budget regressions; verify repeated spawn/terminate operations and payload retirement cannot leave a cumulative receipt or byte leak while session resources remain below their limits.

## 2. Implement bounded retry retirement

- [x] 2.1 Add negotiated stream identity, ordered operation ordinals, acknowledgement messages, and explicit expired-window/capacity reasons in session-protocol; verify serialization, invalid boundaries, and incompatible capability cases with protocol tests.
- [x] 2.2 Implement host receipt retirement and byte reclamation with a persisted retired-through boundary; verify sustained-use regressions pass and retirement remains possible when ordinary mutation admission is full.
- [x] 2.3 Preserve duplicate-result handling, payload conflicts, PTY ordering, and unknown outcomes; verify tests reject retired requests, reused identities at another ordinal, premature acknowledgements, and stale controllers without duplicate side effects.
- [x] 2.4 Add client-wide ordinal allocation and batched/idle acknowledgement flushing across write, resize, spawn, and terminate; verify concurrent completion, lost responses, lost acknowledgements, skipped ordinals, and repeated acknowledgements with deterministic client/host tests.
- [x] 2.5 Integrate stream reconciliation with sidecar daemon-shell and ordered-writer ownership; verify reconnect and controller-transfer tests preserve live PTYs and never resubmit uncertain input under a new identity.

## 3. Preserve upgrade and recovery guarantees

- [x] 3.1 Extend host/daemon checkpoints with retry-stream boundaries and retained results; verify round-trip and corruption tests preserve retirement, input sequences, pending outcomes, and capacity accounting.
- [x] 3.2 Implement supported legacy exhausted-history import with controller fencing and session reconciliation; verify an isolated legacy fixture resumes input and new spawns while preserving live PTY identity and rejecting delayed legacy mutations.
- [x] 3.3 Add automatic supported in-place upgrade on attachment plus replacement and rollback compatibility guards aligned with preserve-sessions-across-updates; verify unsupported versions fail without killing sessions or discarding retry boundaries, and supported replacement preserves duplicate suppression. Stage packaged images and use a stable maintenance identity so interrupted attachment does not create repeated upgrade jobs.

## 4. Report actionable failures

- [x] 4.1 Expose operation-window usage, retained bytes, relevant limits, and retirement progress through read-only diagnostics; verify output distinguishes each capacity budget and excludes input payloads and secrets.
- [x] 4.2 Propagate distinct refusal reasons through existing sidecar and typed renderer IPC/error handling where needed; verify input failures are visible while continued output and PTY liveness remain intact.

## 5. Validate the complete affected system

- [x] 5.1 Run an isolated end-to-end sustained-use scenario beyond 10,240 acknowledged mutations across multiple terminals, then start another terminal; verify input, resize, output, and spawn continue with bounded metadata and no process restart. Include response-loss and replacement cases without touching production sessions.
- [x] 5.2 Run full test and static validation for every affected Rust crate, including session-host, session-protocol, session-client, session-daemon, and the sidecar integration: cargo test, cargo check, cargo build, and cargo clippy from their applicable manifest roots. Verify cross-boundary protocol and checkpoint tests pass and record commands and results.
- [x] 5.3 If renderer or terminal-runtime code changes, run that affected subsystem's full test/type-check scripts, including pnpm test and pnpm exec tsc --noEmit where applicable; run the applicable isolated desktop terminal checks from CONTRIBUTING.md and document any skipped environment-dependent checks.
- [x] 5.4 Validate the final OpenSpec change, update task-scoped Handoff Notes, and report evidence, compatibility limits, live-diagnosis uncertainty, and remaining coverage gaps; verify the notes replacement succeeds before returning the implementation handoff.

## Validation evidence and remaining limitations

- `cargo test`, `cargo check`, `cargo build`, and `cargo clippy --all-targets` passed for session-host, session-protocol, session-client, session-daemon (default features), and the sidecar. Later fixture-only edits passed the complete contract command and affected clippy checks. Daemon clippy reports the existing `process_native.rs` child-wait warning (KVG-5138).
- Run sidecar tests with inherited `OPENFORGE_*` variables removed from the test subprocess environment. With that isolation, 2,338 sidecar unit tests and default integration tests passed. The inherited `OPENFORGE_AGENT_CONFIG` failure is already tracked by KVG-5174.
- `node scripts/session-daemon-contract.mjs` passed, including 24 explicitly enabled sidecar process contracts. Live authenticated Pi and installed-provider demonstrations were skipped because their opt-in environment variables were not set.
- `node scripts/terminal-input-order.mjs /tmp/openforge-kvg-5183-input-order` passed: 660 bytes, zero wrong trials. Evidence: `/tmp/openforge-kvg-5183-input-order/input-order-zzcZWj/`. No renderer/terminal-runtime source changed, so their full unit/type-check suites were not required.
- The 10,400-operation sustained daemon scenario passed repeatedly. Host tests cover lifecycle/byte reclamation, unknown outcomes, retired requests, and checkpoint corruption; client tests cover dropped/corrupt replies, lost acknowledgements, and concurrent clones.
- An actual pre-change daemon built with `replacement-fixtures` upgrades while preserving daemon lifetime/PID, PTY/shell PID, output, and retry fencing. Downgrade to the legacy image is refused without losing the terminal. All four task-specific replacement tests passed with the genuine legacy executable.
- The approved preflight fix enables accelerated SHA-256 and optimizes it in debug builds. The new public capability regression failed on a valid 120 MiB image before the fix and passes afterward. Probe deadlines and refusal rules are unchanged. A normal probe's measured CPU time fell from about two seconds to about 10 milliseconds.
- Final verification passed: default daemon test/check/build/clippy, full sidecar tests, complete daemon/sidecar contract, replacement-feature check/build/clippy, and the 18 enabled replacement tests in two serialized runs. Commands use `--features replacement-fixtures --test replacement -- --test-threads=1`; task-specific legacy coverage adds `operation_retention -- --include-ignored --test-threads=1` with `OPENFORGE_LEGACY_DAEMON` pointing to the archived baseline build.
- Parallel replacement runs can still exceed the unchanged deadline while copied executables stall in macOS dyld before Rust starts. KVG-5188 retains that test-infrastructure issue and the shared-contract assumptions that fail if the fixture feature is enabled across the entire default suite. No permanent suite serialization or safety relaxation was added. Default tests and opt-in replacement tests were validated separately.
- Latest logs: `completion-daemon-*.log`, `completion-sidecar-test.log`, `completion-contract.log`, `completion-replacement-*.log`, and `retirement-optimized-serial.log` under the validation directory below.
- Default legacy builds do not advertise live replacement while its production gate remains disabled. Automatic attachment therefore refuses safely on those builds; it never kills/restarts their daemon or sessions. Production capacity exhaustion remains unconfirmed; no production controller was acquired or daemon replaced.
- Command logs: `src-tauri/target/kvg-5183-validation/` (ignored build output). No commit, deployment, or OpenSpec archive was performed.
