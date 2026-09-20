## 1. Bounded live URL detection

- [x] 1.1 Add failing tests for a streaming GitHub PR URL detector covering split schemes and PR numbers, color escapes, delimiters, punctuation, unrelated hosts, unsupported controls, oversized input, duplicate identities, and reset after gaps; verify the tests fail for missing behavior before implementation.
- [x] 1.2 Implement the focused detector with the design's memory bounds and expiring deduplication; verify all detector tests pass and repeated or oversized output retains bounded state without truncating terminal delivery.

## 2. Task identity and GitHub verification

- [x] 2.1 Add temporary-worktree and fake-GitHub tests for exact URL verification and first-PR branch discovery, including forks, tracked branch names, unresolvable ownership, ambiguous PRs, closed PRs, and same-number PRs in different repositories; verify the missing discovery behavior is red.
- [ ] 2.2 Implement narrow task/session/worktree identity resolution and trusted Git remote resolution for task-owned agent, shell, and scoped sessions; verify the fixtures reject project-only and review-only sessions and resolve the correct task independent of UI selection.
- [x] 2.3 Add the GitHub open-head query and exact candidate verifier using the existing client, authentication, and request limits; verify fake-server assertions cover encoded branch names, complete ambiguity detection, head/base repository matching, draft acceptance, and no arbitrary URL fetching.

## 3. Guarded automatic persistence

- [x] 3.1 Add failing persistence tests for canonical and synthetic identities, rediscovery, additional PRs on one task, another task's ownership, and concurrent manual reassignment; verify the tests expose automatic reassignment or duplication before changing the persistence path.
- [x] 3.2 Implement transactional insert-or-refresh behavior for automatic association without changing explicit manual linking; route task-link reconciliation through that guard and verify ownership, idempotency, matching-precedence, and existing manual-link tests pass.

## 4. Discovery coordination and lifecycle safety

- [x] 4.1 Add deterministic-clock coordinator tests for immediate URL signals, two-second completion debounce, resumed-work cancellation, duplicate hooks, distinct candidates during an in-flight lookup, and recently satisfied discovery; verify observable request counts and timer outcomes fail before implementation.
- [x] 4.2 Implement the sidecar-owned discovery module with a bounded nonblocking queue, one in-flight discovery per task, shared GitHub capacity, and bounded retries; verify rate-limit deadlines, missing credentials, delayed visibility, queue overflow, and later retry eligibility using fake GitHub responses.
- [x] 4.3 Add and satisfy asynchronous race tests for task deletion/completion, changed branch or worktree, PTY replacement, normal completion without replacement, and manual linking during verification; verify no stale result commits and no DB lock spans network I/O.

## 5. Live output and completion adapters

- [x] 5.1 Wire accepted local PTY output in `pty_manager/events.rs` and session registration to the shared detector/discovery interface; verify current task-owned output triggers discovery while stale, replayed, unattributed, and detached-view cases behave as specified.
- [ ] 5.2 Wire current daemon output in `pty_manager/daemon_transport.rs` through the same interface, resetting parser state on gaps and replacement without replay scanning; verify daemon output tests cover reconnect, ordering, hidden views, and a nonblocking saturated discovery queue.
- [x] 5.3 Wire accepted normalized task-agent completion and successful current task-agent exit into the coordinator, including renewed-working cancellation; verify lifecycle tests cover OpenCode and another provider, stale/duplicate notifications, waiting-for-input, review sessions, and hook/exit deduplication.

## 6. Immediate UI delivery

- [x] 6.1 Publish the existing `task-pull-request-updated` event after a newly verified link commits, before optional status enrichment; verify a sidecar integration test starts with no linked PR, observes the committed association and one event, and never advances the periodic poll clock.
- [x] 6.2 Extend `pullRequestAttentionEventListeners.test.ts` or the nearest PR-consumer integration test to cover the newly linked task and unchanged active selection; verify persisted PRs, attention, and counts update through existing listeners without a global GitHub request or terminal remount.

## 7. Independent recovery reconciliation

- [ ] 7.1 Add failing scheduler/execution tests for independent 900-second task-link reconciliation, first eligible startup, manual synchronization, failure retry, focus gating, and unchanged global-list/status cadences; verify global-list-only refreshes do not perform link discovery.
- [ ] 7.2 Separate reconciliation scheduling from `GlobalReviewLists` while retaining authored-list refresh, existing task-ID matching, guarded persistence, and rate-limit behavior; verify the scheduler, poll execution, and review sync suites pass, including a missed-terminal-signal recovery case.

## 8. Affected-system verification and handoff

- [ ] 8.1 Run cross-path integration cases from live terminal output or accepted completion through fake GitHub, persistence, and task PR notification for local and daemon PTYs; verify hidden-view discovery, first-link latency without polling, and unchanged external CI/review/merge updates.
- [x] 8.2 Run full Rust sidecar validation from the crate root resolved by `node scripts/rust-sidecar-layout.mjs backend-crate-root`: `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; verify successful results or record precise environmental blockers and remaining gaps.
- [x] 8.3 Run the full affected renderer test/static checks, applicable event-contract checks, and relevant desktop terminal invariant checks from CONTRIBUTING.md and its linked testing guides; if another workspace or crate changes, run all its test/static scripts too and record the final affected-system coverage.
- [ ] 8.4 Validate the completed OpenSpec change, document the event-first behavior and slower recovery cadence in the appropriate existing user/developer documentation, and update KVG-4655 Handoff Notes; verify artifact validation, documentation accuracy, and successful replacement of the complete notes before handing off.
