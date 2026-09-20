## Context

See proposal.md for motivation and specs/task-pull-request-discovery/spec.md for the behavior contract.

Observed implementation:

- `github_poller/poll_execution.rs` runs global review work every `github_poll_interval * 4`. `PollScope::refreshes_task_links` currently couples initial linking to `Global` and `GlobalReviewLists`.
- `github_poller/review_sync.rs::sync_authored_task_prs` searches authored PRs and matches task IDs in branch, title, then body. This remains the compatibility recovery path, not the event-driven verifier.
- `refresh_task_github_status_for_sidecar` reads existing task PRs and returns early when none exist. It cannot discover a first association.
- `github_runtime/pr_actions/linking.rs` implements explicit manual linking, including synthetic IDs and reassignment. Automatic discovery must not call that operation blindly or inherit its reassignment semantics.
- `pty_manager/events.rs::spawn_batched_pty_event_emitter` receives live local output and filters it with `accepts_passive_output`. `pty_manager/daemon_transport.rs::pump` separately delivers current daemon output and detects event gaps. Both paths require integration; renderer-only detection would miss hidden or detached activity.
- `http_server/legacy_transport/events.rs` publishes accepted normalized agent lifecycle changes. Provider adapters already supply task/session identity; PR discovery should consume accepted transitions rather than interpret raw provider events again.
- `appDesktopEventListeners/pullRequestAttentionEventListeners.ts` already responds to `task-pull-request-updated` by refreshing persisted PRs, attention, counts, and task invalidation.
- The main terminal-session-coordination and task-api-boundaries specs require stale-instance rejection, view-independent session lifetime, and narrow task reads. This design preserves those contracts without modifying their requirements.
- Orca's installed 1.4.194 bundle supplied the reference pattern of a terminal URL as a verification trigger. It is not a source dependency and its bundled implementation will not be copied.

## Goals / Non-Goals

**Goals:**
- Keep terminal parsing fast and independent of GitHub latency.
- Put verification, coalescing, retries, and persistence safety behind one task PR discovery module with a small signal interface.
- Use current task/worktree identity rather than the selected UI task, visible tab, or text mentioning a task ID.
- Preserve existing remote-status polling and task PR consumers.

**Non-Goals:**
- GitHub webhook infrastructure, provider-specific registration prompts, or agent tool interception.
- A general terminal screen scraper or replay scanner.
- GitHub Enterprise, GitLab, or arbitrary hosts beyond the current github.com integration.
- Rewriting the terminal runtime, manual linking, or the entire GitHub poller.
- Changing task status on PR discovery or adding a new PR panel.

## Decisions

### 1. Observe live output in the sidecar, not terminal views

Add a bounded streaming URL detector in a focused Rust module. Feed it only accepted live output at the local PTY emitter and daemon transport seams. The two adapters share the detector and discovery signal interface; they do not implement separate verification rules.

Resolve ownership through existing task/session registration. An agent session, task shell, or scoped task session is eligible only if registration identifies its task and current worktree. Do not infer ownership by parsing arbitrary shell keys or terminal text. Project-only shells and PR review sessions without a task implementation identity are excluded.

Maintain parser state per session key and PTY instance. For daemon delivery, also track contiguous output sequence. Reset on gaps, replacement, disconnect, and teardown. Do not feed snapshots or historical replay. A daemon continues without the sidecar while the app is closed, but missed output is recovered through reconciliation rather than replay scanning.

Daemon inventory protocol v3 includes the immutable canonical spawn directory alongside `TerminalOwner` and the full PTY identity. The Sidecar registers this ownership with the shared discovery module and retains its existing worktree guard. Older checkpoints may omit the directory; those sessions remain recoverable but do not trigger PR discovery. On a transport disconnect, the adapter invalidates pending origins and resumes from a fresh inventory cursor rather than inspecting missed output.

Parsing defaults are a 2 KiB candidate/carry limit and a bounded cache of 128 recently seen canonical PR identities per session. Strip SGR color sequences, recognize ordinary URL delimiters and trailing punctuation, and reject candidates containing cursor controls or unsupported escapes. Do not finalize a number at an arbitrary chunk boundary. Oversized or malformed candidates are discarded. Scanning is linear in incoming bytes and stores no transcript.

Alternative rejected: a renderer subscription or per-component parser, because attachment lifetime and hidden-view recovery deliberately differ from session lifetime.

### 2. One discovery module owns asynchronous work

Introduce a sidecar-owned task PR discovery module, provisionally under `github_runtime/task_pr_discovery/`. Its interface accepts attributed URL signals and accepted lifecycle transitions. It owns task resolution, lookup scheduling, deduplication, verification, guarded persistence, and event publication. Network and database work never runs synchronously in the terminal reader or daemon transport lock.

Use a bounded nonblocking signal queue with 256 slots, at most 128 queued task identities, and at most one in-flight discovery per task. Apply the existing GitHub request limiter and refresh coordination instead of adding an independent unlimited client. Queue overflow records a sanitized diagnostic and leaves recovery to reconciliation; it never stalls PTY output.

Work identity includes task ID, project ID, worktree identity/path, current branch/head repository, session key, PTY instance, and lifecycle generation. A real branch/worktree or session replacement invalidates cached results. Request initiation and commit both resolve authoritative identity with narrow reads. Normal session completion is not itself a replacement: a result may commit for the latest completed session if its task/worktree identity remains valid and no newer session has superseded it.

Alternative rejected: calling the existing task-status refresh, because it has no discovery behavior when the task has zero linked PRs. Keep its meaning unchanged.

### 3. Verify exact candidates and branch-only candidates differently

Extend the current GitHub client with an open-PR-by-head query and use its existing exact PR detail operation. Build endpoints from validated structured owner/repository/number fields, never fetch arbitrary terminal-provided URLs.

Read the actual task worktree's Git configuration and branch. Resolve the head remote using explicit branch push/tracking configuration and origin fallback. Trust base candidates only from the relevant configured GitHub remotes, including origin and an explicitly configured upstream. If identity cannot be resolved unambiguously, fail closed and let manual linking or reconciliation handle it. Reuse or narrowly extend the parser in `github_runtime/repo_resolution.rs`; its existing project-origin cache alone is insufficient for fork/head verification.

For an exact URL, retrieve that PR and require an open state, matching head repository and branch, and a trusted base repository. Drafts are open PRs and are eligible. Consider the tracked remote branch when it differs from the local branch. A URL does not authorize a mismatched PR merely because its title or body mentions the task.

For completion discovery, query trusted base repositories with the qualified head owner/branch, then check returned head repository identity. Detect multiple matches rather than using `per_page=1` and selecting arbitrarily. Deduplicate the same PR returned through equivalent candidates. Link only a single eligible result. Event-driven discovery does not depend on the PR author being the authenticated user; permissions and repository/branch identity provide verification. Existing authored-search recovery retains its current scope and matching precedence.

Alternative rejected: link any printed URL or any matching PR number, which can attach reviewed PRs and unrelated references.

### 4. Debounce completion and retry only bounded transient work

Consume normalized transitions only after lifecycle acceptance and stale-session filtering. A working-to-done/idle implementation transition queues a branch lookup after two seconds. Equivalent signals share the original pending deadline; renewed working activity cancels it. Waiting-for-input and rejected or replayed notifications do not trigger discovery. A current successful task-agent PTY exit can feed the same completion signal when hooks are unavailable, with deduplication against hook completion.

An exact URL signal is processed without the completion debounce. Coalesce it with pending work for the same task. If distinct URL candidates arrive during a branch lookup, retain bounded follow-up candidates instead of dropping them all. Suppress a redundant completion lookup only when discovery succeeded for the same worktree/head identity within the preceding 30 seconds; an older association does not suppress discovery of a later PR.

Use at most two delayed retries, at 2 and 10 seconds, for transient failure or a recently created PR not yet visible. Respect a later server retry/reset deadline, and never clear shared rate-limit state merely to force a discovery request. Authentication failure and verified mismatch do not spin. Expire deduplication failures so later completion or reconciliation can retry. Clock, GitHub transport, and identity resolution are injected at the module's test seams.

### 5. Persist canonical PRs with non-reassignment semantics

Add a narrow transactional automatic-association operation in PR persistence. It checks canonical GitHub ID and repository/number identity together. It can insert an unclaimed PR or refresh the same task association, but returns an ownership-conflict outcome for another task. Handle existing same-task synthetic manual rows without producing a duplicate row; retain or reconcile their identity through the established persistence rules.

Keep explicit manual linking behavior unchanged. Use the guarded automatic operation for both event discovery and task-link reconciliation so a later recovery scan cannot undo a user-selected association. A task may have multiple verified PRs; do not replace its entire PR list. Revalidate current task/worktree/session context immediately before the transaction and reject stale generations. Do not hold the database mutex over network requests.

Commit the association and basic GitHub metadata first, then emit the existing `task-pull-request-updated` event using its existing payload contract. CI and review enrichment can follow through the existing targeted status refresh; it must not delay the initial link event. Emit no link-created event for a no-op association. The renderer continues to use typed IPC wrappers and existing PR/attention listeners.

Alternative rejected: using manual linking's synthetic optimistic row before GitHub verification, which would expose an unverified association and allow unintended reassignment.

### 6. Give reconciliation its own clock

Separate task-link reconciliation eligibility from `GlobalReviewLists`. Add a dedicated reconciliation scope or explicit phase with its own last-success timestamp and a fixed 900-second due interval. Keep `github_poll_interval` and the global-list multiplier unchanged for their existing purposes.

The first eligible startup cycle requests reconciliation. Manual full synchronization includes it regardless of the background interval. Failed reconciliation does not advance its success timestamp; it retries on a later eligible scheduler wake, subject to existing rate-limit backoff. Automatic cycles preserve focus gating. Targeted local-signal work is allowed while unfocused because it follows actual task activity, not an idle periodic scan.

Do not remove authored PR list synchronization or status polling when moving the link phase. Avoid duplicate authored searches in a cycle where list and link phases are both due by reusing the same fetched snapshot where the existing structure permits it. Add scheduler tests that prove a global-list-only cycle cannot perform task-link reconciliation.

Alternative rejected: deleting reconciliation entirely, because PRs can be created in a browser, while the app is closed, or without a complete terminal URL. Merely lowering the global poll interval would increase traffic without addressing the first-link delay reliably.

## Risks / Trade-offs

- Terminal output can contain unrelated or malicious URLs -> treat text as a hint, verify full Git identity, restrict hosts, and preserve existing ownership.
- TUI redraws or unsupported escape sequences can hide a URL -> fail closed and use completion discovery plus reconciliation instead of implementing a screen parser.
- Slow global refresh work can delay targeted verification -> share request capacity, avoid a full global scan for local signals, and measure queue delay separately from request latency.
- A 15-minute fallback increases delay for PRs created elsewhere -> retain startup/manual synchronization and document that only locally observed creation gets immediate discovery.
- Forks and reused branch names can be ambiguous -> verify head repository, tracked branch, and trusted base candidates; skip ambiguous results rather than guess.
- Local and daemon transport paths can diverge -> exercise both adapters against the same detector and stale-instance/gap cases, including a hidden or absent view.
- A task/worktree may change during network I/O -> generation checks and guarded persistence prevent stale results from linking the new session.
- Broad existing modules are easy to grow -> keep parsing and orchestration in focused modules and add only small adapter calls at existing output/lifecycle seams.

## Migration Plan

1. Add detector, verifier, guarded persistence, and coordinator tests before each corresponding implementation slice.
2. Wire both output adapters and normalized completion signals, retaining the existing discovery cadence until the new path passes integration checks.
3. Switch background task-link reconciliation to its independent 15-minute clock only after event-driven first-link behavior and UI delivery are verified.
4. No schema migration is planned. Existing PR rows and manual links remain valid. If canonical identity handling exposes a required schema change, stop and revise this plan before implementing it.
5. Rollback removes the signal integrations and restores the old reconciliation scheduling. Persisted associations remain ordinary PR records; no destructive rollback or data deletion is needed.

## Verification

Use deterministic clocks, the existing fake GitHub HTTP server pattern in `github_poller/tests/review_sync_tests.rs`, and temporary task/worktree fixtures. Assert request counts and persisted/event outcomes rather than private implementation shape.

Cover split/colorized/duplicate/oversized URLs, output gaps and replay, both PTY backends, completion debounce/cancellation, missing credentials, delayed visibility, rate limits, fork/upstream identity, ambiguous candidates, stale completion, manual-link races, first-link discovery, and UI invalidation before any periodic clock advances.

This crosses terminal lifecycle, GitHub persistence, and event contracts. Implementation therefore requires full affected-system validation: Rust sidecar `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` from the crate root resolved by `scripts/rust-sidecar-layout.mjs`; renderer tests and TypeScript checks if event consumers change; applicable event-contract checks; and all test/static scripts of any additional workspace actually changed. Run the desktop terminal invariant checks appropriate to the changed transport paths. Follow CONTRIBUTING.md for exact commands and report environmental skips. No behavioral tests are required for this planning-only change.
