## 1. Recognize complete hyperlink targets

- [x] 1.1 Add failing detector tests for a short clickable PR label, BEL and ESC-backslash terminators, empty and nonempty parameters, opening-only emission, every chunk split position, and byte-at-a-time delivery. Run `cargo test github_runtime::task_pr_discovery::detector` from the resolved backend crate root and record the expected missing-recognition failures before implementation.
- [x] 1.2 Implement explicit bounded OSC 8 framing in the shared detector, emit only after a complete opening sequence, and reuse canonical URL parsing and duplicate suppression. Verify task 1.1 tests pass and existing visible/colorized URL tests remain green.

## 2. Preserve parser safety and recovery

- [x] 2.1 Add regression tests before further fixes for empty close targets, malformed framing, unsupported controls and hosts, exact 2 KiB and over-limit payloads, unrelated OSC/DCS, unterminated strings, and recovery to a valid link after a terminator. Verify rejected payloads emit nothing and subsequent valid links emit once; make only the parser corrections needed to pass.
- [x] 2.2 Add tests for visible/hidden duplicate identities in both orders, cache expiration, parameter/label isolation, partial visible URLs around control strings, and reset during a partial opening sequence. Verify shared deduplication behavior is unchanged and fragments never manufacture a candidate; fix any regressions within the detector.

## 3. Verify live discovery integration

- [x] 3.1 Extend existing task PR discovery fixtures and the local shell test in `pty_manager/session/spawn/tests/shell/pr_discovery.rs` with hidden-target output before implementation adjustments. Verify a first PR is persisted and `task-pull-request-updated` is emitted without an attached view, agent completion, or periodic polling; verify mismatched repository/branch candidates remain unlinked.
- [x] 3.2 Add a failing live-daemon hyperlink discovery test that keeps the process running until linking succeeds; verify it fails before daemon output wiring. Integrate with the daemon discovery adapter and verify authoritative attribution, full PTY identity and sequence fencing, raw-byte input, disconnect/gap handling, teardown, and nonblocking submission. On rebase, retain the upstream inventory-based adapter from PR #2549 and port hyperlink regressions to it. Run the live daemon test and `node scripts/session-daemon-contract.mjs`.

## 4. Validate the affected system

- [x] 4.1 Run full Rust sidecar `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` from `node scripts/rust-sidecar-layout.mjs backend-crate-root`. Run applicable terminal transport checks if adapters changed, and tests/static checks for any additional package actually changed. Record command outcomes, skipped checks, and environment blockers.
- [x] 4.2 Run `openspec validate detect-terminal-pr-hyperlinks --strict`, confirm the diff stays within hyperlink detection and its tests, and update task Handoff Notes with the delivered user-facing behavior and remaining gaps. Verify the validation and notes update both succeed.

## Verification evidence

- Red checkpoints: the initial hyperlink detector test failed with no candidate; the live-daemon test failed while the shell remained running; the gap/exit regression failed by incorrectly linking a PR. Each passed after its corresponding implementation.
- Rebased onto main `d82cffdc5`. Conflict resolution retained upstream daemon discovery from PR #2549, removed the duplicate branch adapter, and ported hyperlink tests to the upstream path.
- Final focused `cargo test discovery`: 96 passed.
- The first rebase's default `cargo test` hit an intermittent five-second timeout in the unchanged upstream `daemon_queue_overflow_never_waits_for_github_and_later_output_can_retry` test, tracked separately in KVG-5120. Final full `cargo test -- --test-threads=4` passed with 2,288 main-binary tests and 21 ignored; integration suites passed with 22 daemon cases ignored by the default command.
- `cargo check`, `cargo build`, and `cargo clippy`: passed.
- Final `RUST_TEST_THREADS=1 node scripts/session-daemon-contract.mjs`: passed, including explicit daemon integration cases and live shell/agent hyperlink tests. The first run on the latest main failed during an unchanged companion test's process-group cleanup with EPERM; follow-up KVG-5130 tracks that intermittent failure.
- Daemon contract builds report an existing unused `IMAGE_VERSION` import in an unchanged crate. No new dependency or protocol change was needed.
- Scope: full Rust sidecar plus daemon cross-boundary contracts. Renderer suites and headed Electron UI checks were not run because renderer code, event payloads, and terminal presentation were unchanged. The original reported terminal recording was unavailable; standard OSC 8 was tested through real local and daemon PTYs.
