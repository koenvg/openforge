# KVG-5084 verification

## Scope

Completed independent 300-second task-link recovery in the Rust GitHub poller, revised from 15 to five minutes at the user's request. The first eligible startup cycle and manual full synchronization request recovery immediately. Periodic focus gating and shared rate-limit deadlines remain in force. Recovery success is recorded separately from list-refresh failures. Combined recovery/list work reuses its authored snapshot; list-only work cannot create task links. Existing matching precedence and ownership-preserving persistence remain unchanged.

The README now describes local and daemon URL verification, two-second completion discovery, 5-minute recovery, and retained adaptive status polling. The parent KVG-4655 was not modified.

## Test-first evidence

- The list-only execution test failed because the old scope created a task association, then passed after discovery was separated.
- Scheduler tests initially failed to compile until the independent cadence and recovery scopes existed. The five-minute revision failed at the new 300-second boundary before changing the interval. Tests cover startup, the exact boundary, configurable global-list cadence, focus/rate-limit gates, retry after failure, and operation before frontend context arrives.
- Execution tests failed on duplicate authored searches and on clearing an active shared rate-limit deadline, then passed after snapshot reuse and backoff preservation.
- A missing authored PR detail initially reported successful recovery. The regression now fails the recovery phase and verifies a later successful retry.
- A separate phase-result test verifies that successful recovery remains successful when the global review-list refresh fails.

## Fast path and fallback

These tests pass without starting or advancing periodic polling:

- `live_local_shell_output_links_first_pr_without_any_terminal_view`
- `daemon_pump_links_without_views_and_delivers_output_during_slow_github`
- `successful_local_agent_exit_links_first_pr_without_hooks_or_output`
- `daemon_agent_exit_discovers_without_daemon_output_integration`
- `successful_agent_exit_discovers_first_pr_after_debounce_without_polling`

Separate recovery execution tests start with no terminal signal, recover an authored PR, retain one association, and emit only one link notification across rediscovery. Existing matching tests cover branch/title/body precedence and ambiguity; ownership tests cover manual association races. `linked_pr_status_polling_observes_external_ci_review_comments_and_merge_without_discovery` verifies external changes without another discovery search.

## Final checks

For the five-minute revision, the complete Rust test suite, check, build, and clippy were rerun and passed with the same counts below. Renderer, daemon-contract, and desktop-invariant results are from the preceding full validation; they were not rerun for this interval-only change. No event or terminal behavior changed.

- `pnpm i`: passed; no manifest or lockfile changes.
- `cargo test -- --test-threads=4`, from `src-tauri`: passed. 2,271 unit tests and five default integration tests passed. The default run reports 17 unit and 20 integration tests ignored; daemon-specific coverage was run separately below.
- `cargo check`, `cargo build`, `cargo clippy`, from `src-tauri`: passed without warnings.
- `node scripts/session-daemon-contract.mjs`: passed. Includes host/protocol/client/daemon crate tests, real Sidecar/Session Daemon replacement, ignored daemon output/completion discovery tests, and plugin/Companion terminal contracts.
- `pnpm test`: 841 files passed, 10 skipped; 7,172 tests passed, three expected failures, 36 skipped. Includes renderer PR event consumers and terminal lifecycle suites.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`: passed.
- `pnpm e2e:invariants -- --output /tmp/KVG-5084-invariants-final`: passed `first-attachment`, `detach-during-recovery`, and `idle-resources`; owned-process cleanup passed.
- `openspec validate link-task-pull-requests-from-events --strict`: passed.
- Changed Rust files were formatted; `git diff --check` passed.

Only the Rust sidecar and documentation changed in this task. No additional workspace source changes require further package-specific scripts.

## Gaps and follow-ups

- The first default-concurrency Rust run timed out after 600 seconds in the existing PTY cleanup test. That test passed alone, and the complete suite passed twice with four test threads. Tracked as KVG-5128; the timeout is not counted as a successful run.
- Installed live-provider demonstrations were skipped because `OPENFORGE_LIVE_PI_AUTH`, `OPENFORGE_LIVE_PROVIDER_BIN`, `OPENFORGE_LIVE_OPENCODE_BIN`, and `OPENFORGE_LIVE_GROK_BIN` were unset. Deterministic provider fixtures passed; no real GitHub account or live agent was used.
- Opt-in visual/performance/browser tests reported as skipped by the renderer suite and manual scale benchmarks were not enabled. The isolated desktop invariant suite ran separately.
- pnpm reported ignored dependency build scripts for `@vgpu/adapter-node`, `esbuild`, and `webgpu`; validation above still passed.
- KVG-5127 tracks existing GitHub search pagination and explicit snapshot-completeness limitations, including truncated searches. This task detects missing detail results when the client supplies the complete search identity list.
- KVG-5129 tracks splitting the large poll-scope executor into cohesive phases without changing policy.

Local logs are under `/tmp/KVG-5084-*`; the final desktop report is `/tmp/KVG-5084-invariants-final/report.json`.
