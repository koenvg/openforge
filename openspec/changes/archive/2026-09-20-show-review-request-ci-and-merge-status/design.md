## Context

See proposal.md - Why.

The renderer side is already done. `packages/pr-review-ui/src/ReviewPrCard.svelte` calls `getPrStatusChips(pr, 'compact')`, the same call `AuthoredPrCard.svelte` makes. `PrInput` in `packages/plugin-sdk/src/prStatusPresentation.ts` declares `ci_status` and `merged_at` as optional, so `ReviewPullRequest` already satisfies it. The chips are absent only because the fields are absent.

Three constraints shape the approach.

**The review search is open-only.** `review_requested_pr_search_url` queries `state:open+draft:false` (`src-tauri/src/github_client/pulls.rs:46`). A merged pull request leaves the result set.

**The list is sticky.** `mark_review_prs_not_requested` keeps the row and flips `review_requested = 0`. Nothing re-reads it, so `state` stays a stale `"open"` forever.

**Two write paths duplicate the upsert.** `github_runtime/polling.rs:58` `fetch_review_prs` serves the Refresh button. `github_poller/review_sync.rs:382` `poll_review_prs` serves the background poll. The upsert loop is copied verbatim in both.

Both problems already have a solved twin in the codebase: `authored_pr_sync.rs` for check enrichment, and `github_poller/review_sync.rs:147` `reconcile_stale_authored_task_prs` for resolving a pull request that fell out of an open-only search.

## Goals / Non-Goals

**Goals:**

- One place owns review-request enrichment and persistence, so the Refresh button and the background poll cannot drift.
- The check aggregation is literally the same code the authored list uses, not a second implementation of the same rules.
- A failed signal fetch preserves the stored value instead of overwriting it with null.

**Non-Goals:**

- No renderer change. If this design needs one, something is wrong.
- No change to authored pull request sync behaviour.
- No `ci_check_runs` column on review requests. The compact chip needs only the aggregate. Add it when a review surface needs the per-check list.
- No new GitHub endpoints. Every call already exists on the client.

## Decisions

### Extract a shared review-request sync module

Add `src-tauri/src/review_pr_sync.rs` holding enrich-and-persist for review requests, and call it from both `fetch_review_prs` and `poll_review_prs`. This mirrors `authored_pr_sync::enrich_and_persist_authored_prs`, which its own two callers already share.

*Why:* the spec requires the Refresh button and the background poll to produce the same signals. A shared function makes that structurally true. Adding the new fields to two copied loops makes it a convention that the next edit breaks.

*Alternative rejected:* add the fields to both loops in place. Cheaper now, but it doubles a loop that is already a copy, and the copy is what the spec forbids.

### Share the check aggregation, do not re-derive it

Extract the paired fetch (`get_check_runs` + `get_combined_status`, reduced by the existing `github_client::aggregate_ci_status`) out of `authored_pr_sync::enrich_authored_pr` into a helper both sync modules call.

*Why:* the spec says review requests use the same aggregation as authored pull requests. A shared helper cannot drift; two call sites of `aggregate_ci_status` with their own fetch and error handling can.

*Alternative rejected:* call the two endpoints again from the new module. It is four lines, and it is exactly how the two upsert loops got out of hand.

### Resolve merge state only for kept entries

Add a reconcile step over review-request rows where `review_requested = 0 AND state = 'open' AND dismissed_at IS NULL`. For each, fetch pull request details and write the terminal state, reusing the shape of `terminal_state_for_pr_details` (`github_poller/review_sync.rs:130`).

*Why:* the candidate set is self-limiting. Writing `state = 'closed'` or a `merged_at` removes the row from the next run's candidates, so steady-state cost is zero calls.

*Alternative rejected:* widen the search query to include closed pull requests. That pulls in every pull request the user was ever asked to review, and `search_prs_with_details` fans out one detail call per result. The cost grows without bound for a signal that matters on a handful of rows.

### Best-effort enrichment, and never write a null over a known value

Review requests enrich best-effort: a card still appears when checks are unreachable. The upsert writes check state as `COALESCE(excluded.ci_status, review_prs.ci_status)`.

*Why:* the spec requires a failed fetch to keep the last known value. `authored_pr_sync` under `AuthoredPrEnrichmentPolicy::BestEffort` passes `None` into an upsert that assigns `ci_status = excluded.ci_status`, so a partial failure there clears a known status. Do not copy that. It is out of scope to fix on the authored side.

### Take the review-request row as a struct

`upsert_review_pr` already takes 20 positional arguments behind `#[allow(clippy::too_many_arguments)]` (`src-tauri/src/db/review.rs:36`). Change it to take a `ReviewPrUpsert` struct rather than growing to 22.

*Why:* four of the arguments are `Option<&str>` and adding two more makes a silent mis-ordering likely. After the shared sync module lands there is one call site, so the change is contained.

### Two nullable columns, no backfill

A guarded additive migration adds `ci_status TEXT` and `merged_at INTEGER` to `review_prs`, copying the shape of the existing `mergeable` and `mergeable_state` migrations.

*Why:* nullable additive columns need no backfill. Existing rows report no check state until the next poll writes one, which the spec already allows for a pull request with no checks.

## Risks / Trade-offs

- **Two extra GitHub calls per review request per poll.** → Both check endpoints go through `conditional_get` with a stored ETag (`github_client/response_cache.rs:141`). An unchanged head commit returns 304, which GitHub does not count against the primary rate limit. The real cost lands only on the first poll after a push.
- **A merged pull request stays on the list.** → Out of scope, and it now reads as merged rather than as open work. Removing entries by hand still works.
- **The shared sync module touches both poll paths.** → Lifecycle and contract code by AGENTS.md, so this needs full sidecar validation plus the TypeScript contract check, not a narrow test run.
- **Reusing `authored_pr_sync` internals invites coupling the two lists.** → Extract only the check-signal fetch. Keep the enriched row types, the policies, and the stale handling separate, because the two lists diverge on all three.

## Migration Plan

One guarded additive migration, nullable columns, no backfill and no data rewrite. An older build ignores the two columns, so rollback is a no-op.

## Open Questions

- Should a merged or closed review request drop off the list on its own after some time, rather than waiting for a manual removal? Deferrable: it changes no requirement here.
