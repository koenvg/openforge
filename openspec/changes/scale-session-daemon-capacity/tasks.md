## 1. Establish capacity contracts

- [x] 1.1 Add failing isolated daemon tests for the 33rd and 256th concurrent PTY, mixed agent/indexed-shell ownership, independent I/O and recovery; verify the tests expose the current 32-session refusal before implementation.
- [x] 1.2 Add failing turnover tests exceeding 128 exited allocations plus delayed recovery, reconnect, notification settlement, and stale operation retries; verify the old lifetime retention ceiling is reproduced without touching installed app data.
- [x] 1.3 Add failing macOS arm64 replacement-fixture tests for 33 and 256 live PTYs, forced checkpoint-budget refusal, inherited-FD validation, and unchanged PID/PTY/order after success or refusal; verify the current 32-resource/36-descriptor failure is observed.

## 2. Make admission and history sustainable

- [x] 2.1 Add bounded resource accounting and headroom checks for spawn admission across the shared host and daemon, including occupied/restore descriptors, process and checkpoint pressure; verify unit tests accept provisioned 256-session fixtures and refuse a new spawn safely at each limiting budget.
- [x] 2.2 Coordinate bounded exited-record retirement across backend table, host inventory, sequence metadata, journal settlement, and receipt fences; verify turnover/reconnect tests permit new spawns after 128 exits without evicting live or draining sessions or replaying retired mutations.
- [x] 2.3 Extend typed capacity errors and read-only inventory diagnostics for OS/checkpoint versus session/history versus receipt pressure; verify client/protocol contract tests identify the limiting resource and assert that payloads and secrets are absent.

## 3. Keep replacement safe at scale

- [x] 3.1 Remove coupled 32-resource/36-descriptor checkpoint assumptions while preserving FD uniqueness, ownership, and inheritance checks; verify 256-PTY replacement-fixture tests and corrupted/duplicate-descriptor negative tests.
- [x] 3.2 Bound and measure the combined host/backend/journal/header checkpoint and restore headroom, including dense terminal state and failure before exec; verify oversized checkpoints refuse replacement while every original PTY remains usable.
- [x] 3.3 Scale the coordinated pause/serialization window for 256 live readers without unbounded interruption; verify measured handoff duration and timeout/rollback tests under concurrent output and input.
- [ ] 3.4 Migrate validated legacy 32-session checkpoint limits only after a compatible successful handoff; verify old-image rollback before commit, new admission after commit, explicit incompatible downgrade rejection, and no restart of existing PTYs.

## 4. Validate and document

- [x] 4.1 Run full affected-system test/check/build/clippy for session-host, session-protocol, session-client, session-daemon and applicable backend IPC contracts; verify all pass and report any platform-only coverage gaps.
- [x] 4.2 Run the isolated 256-PTY macOS arm64 spawn, turnover, recovery, and supported replacement workload with recorded FD/memory/checkpoint/pause measurements and full cleanup; verify all processes retain identity and no fixture-owned process leaks.
- [ ] 4.3 Update daemon capacity and compatibility documentation with measured safe envelope, observable refusal/expiry behavior, supported upgrade/downgrade matrix, and unsupported legacy-daemon handling; verify docs match the final tests and protocol diagnostics.
