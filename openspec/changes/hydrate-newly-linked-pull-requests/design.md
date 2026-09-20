## Context

See proposal.md for motivation and specs/task-pull-request-hydration/spec.md for the behavior contract. This design is required because the change crosses asynchronous scheduling, persistence, typed contracts, and the GitHub Sync plugin.

Observed implementation:

- `github_runtime/task_pr_discovery/execution.rs` persists basic verified metadata, emits `task-pull-request-updated`, and records recent discovery success. It does not schedule enrichment after that commit.
- `github_runtime/pr_actions/linking.rs` preserves manual-link semantics and can insert a synthetic identity with placeholder metadata. Its callers need a post-commit hydration signal; the database operation itself should remain independent of async network work.
- `github_poller/review_sync.rs` owns recovery associations. Reconciliation can already run alongside polling, so it must not cause a duplicate fetch for a PR handled in that cycle.
- `github_poller/pr_execution.rs` and `pr_readiness.rs` already collect the relevant REST/GraphQL inputs, including CI, reviews, requested reviewers, comments, and policy-derived readiness. Reuse this logic rather than build another interpretation of GitHub status.
- `refresh_task_github_status_for_sidecar` in `poll_execution.rs` operates on open task PRs and clears the shared rate-limit deadline. It is not an appropriate automatic hydration entrypoint unchanged.
- `plugins/github-sync/src/task/TaskPullRequestStatus.svelte` links and reloads its cache without a remote refresh. `useTaskPullRequestRevalidation.svelte.ts` also reloads persisted state on events. Nearby tests explicitly expect event revalidation not to call remote refresh.
- Existing readiness timestamps and `last_polled_at` do not by themselves describe success of every required detail source. A merge-readiness result can legitimately remain unknown after a successful fetch.

## Goals / Non-Goals

**Goals:**
- One backend owner for hydration scheduling, retry classification, and persisted fetch status.
- Share detail collection and persistence with polling while making source completeness explicit.
- Keep link visibility fast and UI invalidation cheap, including for hidden tasks.

**Non-Goals:**
- Changing discovery verification, ownership/reassignment rules, terminal parsing, or polling intervals.
- Making merge readiness determinate when GitHub or policy permissions cannot establish it.
- Fetching unrelated repositories or performing global synchronization after every link.
- Redesigning the PR card, review workflow, or general GitHub poller.

## Decisions

### 1. Schedule hydration after association commit in the sidecar

Add a focused hydration coordinator under the GitHub runtime. All association-producing service entrypoints submit a logical PR identity after successful persistence: event discovery, explicit linking, and reconciliation. Persistence records pending work with the association so a crash between commit and enqueue remains recoverable. Emit the initial link event without waiting for network enrichment.

Use repository owner/name/number plus task association identity, not only the numeric database ID, because manually linked rows can have synthetic IDs. Newly created or incomplete associations are eligible; repeated discovery of a fully hydrated association does not restart initial hydration. Reconciliation reuses a successful current-cycle fetch when available.

The coordinator owns at most one active operation per logical PR, a bounded pending set of 128 identities, and the existing shared GitHub request permit. Pending database state is authoritative if the in-memory queue is full. Drain eligible pending rows in bounded batches as capacity frees and on startup. No renderer mount or focus gate controls this work.

Alternative rejected: remote refresh from the link-event listener. That misses hidden views and risks refresh/event loops. Blocking the link response on all GitHub requests also makes linking unnecessarily slow.

### 2. Reuse detail collection with an explicit outcome

Expose the existing single-PR collection/persistence path through a narrow backend operation used by hydration and ordinary refresh. Return a typed outcome with source success/failure, retry category, observed head identity, and sanitized error category. Do not infer completion from an aggregate `PollResult` or from unchanged CI/review values.

Required groups are canonical PR metadata/lifecycle/head, CI checks and statuses, reviews/requested reviewers, comments, and supported merge-readiness inputs. A successful empty response completes its group. An API response that explicitly reports unknown mergeability is a successful retrieval with an unresolved value. Transport failures and inaccessible required inputs remain incomplete. Existing valid REST/GraphQL fallbacks can satisfy a group; do not require every optional endpoint to succeed when equivalent authoritative data is available.

Persist successful groups without replacing failed groups with empty arrays or defaults. Readiness must still be conservative when any required evidence is unavailable. Include closed/merged manually linked PRs in this one-shot hydration path rather than relying on the current open-PR-only task refresh selector.

Alternative rejected: copying endpoint calls and readiness calculation into discovery. That would drift from background polling and reviewer presentation.

### 3. Persist fetch status independently of readiness

Add an additive PR hydration record/state using the existing migration mechanism. Store state (`pending`, `fetching`, `partial`, `complete`, or `failed`), attempt count, next eligible retry time, sanitized error category, last successful hydration time, and a generation/head identity for guarded writes. Represent missing legacy state as `untracked` in typed reads rather than claiming completeness from old timestamps. Internal per-group outcomes need not all become public fields.

Expose a small additive hydration summary through `PrRow`, the host's PR read mapping, and Plugin SDK `PullRequestInfo`. Legacy/older payloads lacking the summary retain current presentation, not a permanent spinner. Existing rows become tracked through their next normal refresh; do not enqueue the entire historical PR collection during migration. Newly associated rows always begin tracked.

After restart, interrupted `fetching` work becomes eligible pending work, retaining attempt counts and retry deadlines. Previously complete details remain visible during later refresh and failure. Manual and periodic refresh use the same outcome bookkeeping so either can finish or recover hydration.

Alternative rejected: derive loading from `readiness_unknown`, null mergeability, or empty reviewers. Each can be a valid final GitHub result.

### 4. Bound retry episodes and protect current data

Use one initial attempt and at most two delayed retries, provisionally after 2 and 10 seconds. Inject clock and transport for deterministic tests. Honor the later of the local retry delay and server retry/reset deadline; recheck the shared deadline after acquiring request capacity. Never call the clear-rate-limit path merely to start automatic work. Apply a finite per-attempt timeout, initially 30 seconds, and release request capacity while waiting.

Retry timeouts, network/5xx errors, and short-lived 404s immediately following a new association. A server-directed rate limit defers remaining work without spinning. Authentication or permanent access failure ends the episode. Successful retrieval with GitHub mergeability still calculating can use the remaining two follow-ups, but persistent unknown readiness does not count as a failed fetch or restart the episode. Exhausted or blocked work is recovered by existing manual/background refresh, not repeated link events. Keep persisted attempt counts across restart so restarting cannot reset the automatic retry budget.

Coordinate ordinary polling and manual refresh for the same PR with the shared operation. Revalidate association, generation, and head at commit. Do not hold the database lock during network calls. On a head change, reject obsolete head-dependent data and schedule current-head work rather than publishing mixed-revision CI/readiness. Association deletion or reassignment invalidates the old operation. Preserve logical identity through synthetic-to-canonical reconciliation.

Alternative rejected: unbounded polling until readiness becomes known. Some unknowns are permanent permissions or policy limitations, and this would waste requests.

### 5. Publish fetch transitions and render them locally

Publish task PR invalidation after persisted fetch-state transitions and successful data updates, even when CI/review summaries are unchanged. Reuse `task-pull-request-updated` where its existing payload contract permits; update contract tests if an additive action value is needed. Event consumers continue loading persisted data only.

Keep the existing card layout, title, state badge, URL, and manual-refresh control. Add a small status line for first fetch (`Fetching details...`), partial/error results, and rate-limit/authentication deferral. Suppress only the ambiguous unknown-readiness placeholder during first retrieval; definitive fetched status and existing details remain visible. Once retrieval completes, render the existing readiness presentation, including genuine `Readiness Unknown`. Do not enable merge/enqueue based on hydration completion.

Use the existing GitHub Sync task client and SDK domain contracts, not direct untyped host calls. Task switching must not display another task's error or loading state. No CSS-only assertions are needed; test visible status, preserved data, event delivery, and refresh behavior.

Alternative rejected: replacing the whole card with a loading skeleton. The verified PR link is already useful and should remain accessible.

## Risks / Trade-offs

- More requests immediately after linking -> target one PR, reuse cycle results, coalesce duplicate work, and share rate limiting.
- Partial fetch success is currently summarized in several places -> add typed completeness at the shared collection boundary, with fake-server tests for individual failed sources.
- Migration and public contract additions increase scope -> keep the summary additive and tolerate missing legacy values; test old databases and payloads.
- Concurrent link, poll, and refresh operations can overwrite newer data -> validate association/generation/head and serialize commits for a logical PR.
- An indefinite server backoff could look like active fetching -> show deferred status and retain manual refresh without implying that it bypasses server restrictions.
- Existing discovery work is still an active OpenSpec change -> implement against its current code without rewriting that change's artifacts or weakening its verification contract.

## Migration Plan

1. Add migration and typed hydration summary with legacy-compatible reads, plus guarded persistence tests.
2. Add the shared per-PR outcome and coordinator with fake clocks/transport before wiring association producers.
3. Connect discovery, manual linking, and reconciliation, preserving immediate link publication.
4. Render persisted fetch state in the GitHub Sync plugin; validate end-to-end event-driven completion and manual recovery.
5. Rollback disables the new scheduling/presentation paths and leaves additive hydration metadata unused. Do not remove PR associations or perform a destructive down-migration; ordinary polling remains the fallback.

## Verification

The implementation changes persistence, concurrency, and typed contracts, so it requires full affected-system validation. Run Rust `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` from the crate resolved by `scripts/rust-sidecar-layout.mjs`. Run GitHub Sync plugin `test`, `typecheck`, and build; Plugin SDK tests, build, and published-contract checks; renderer tests, TypeScript, and lint; and desktop IPC contract checks. Add companion contract checks if the shared PR response is exposed through that mapping. Follow CONTRIBUTING.md and package scripts for exact invocations. Exercise focused fake-server, migration, and component tests before broader validation. Report environmental blockers and skipped checks. Planning alone requires OpenSpec validation, not product builds.
