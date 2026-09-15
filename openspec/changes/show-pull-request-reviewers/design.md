## Context

See proposal.md for motivation and specs/task-pull-request-reviewers/spec.md for the behaviour contract.

What exists today:

- `github_poller` already fetches, per poll and per task pull request, both the review list (`GET /pulls/{n}/reviews`) and the pull request details that carry `requested_reviewers` and `requested_teams`.
- `pr_readiness.rs::has_requested_reviewers_from_details` throws the requested lists away and keeps a `bool`.
- `github_client/reviews.rs::aggregate_review_status` throws the reviewer logins away and keeps one of `approved`, `changes_requested`, `review_required`, `none`.
- `pr_details_result` is consumed inside `pr_execution.rs` and is **not** carried into `PollSinglePrResult`, so the poller cannot reach the requested lists downstream today.
- `pull_requests` already carries a nullable JSON-TEXT `labels` column, added by an additive guarded migration with `serialize_labels_column` / `parse_labels_column` helpers. That is the pattern this change copies.
- The task card lives in the `github-sync` plugin (`PullRequestCard.svelte`) and already renders a "Pipeline checks" block of icon plus name rows.

Constraint that shapes everything: GitHub API rate limits. The data is already in hand, so nothing here may add a request.

## Goals / Non-Goals

**Goals:**

- One reviewer list per cached task pull request, durable across restarts.
- Verdict derivation lives in one tested pure function per side (Rust for gathering, TypeScript for presentation), not spread over components.
- No new GitHub requests, no new poll pass.

**Non-Goals:**

- Avatars. Rows show identity text only, matching the Pipeline checks rows beside them.
- Any reviewer presentation outside the task pull request card.
- Requesting, adding, or removing a reviewer from inside the app. Read only.
- Gating reviewers on head SHA. They mirror the last successful sync, exactly as `review_status` does today.

## Decisions

### Store the reviewer list as a nullable JSON-TEXT column on `pull_requests`

Column `reviewers`, holding an array of `{ login, kind, state }` where `kind` is `user | team | bot` and `state` is `approved | changes_requested | commented | dismissed | pending`. NULL when there is nothing to report, which makes the spec's "omit when nothing to report" rule fall out of the data.

Migration is an appended, additive, guarded `ALTER TABLE ... ADD COLUMN`, copied from the `labels` migration. Migration slots are append-only in this repo; retired slots are kept as empty `M::up("")` so `user_version` stays aligned. Never insert into the middle.

*Alternatives considered:* a normalised `pr_reviewers` table. Rejected: the list is small, always read whole, always replaced whole, and never queried by reviewer. A join buys nothing and costs a second write path. Recomputing on read from a raw reviews blob was also rejected, because the poller would then have to persist raw GitHub payloads it does not keep today.

### Replace the poller's `has_requested_reviewers: bool` with the requested list

`RestReadinessSources` and `PollSinglePrResult` carry `requested_reviewers: Vec<RequestedReviewer>` instead of the `bool`. Existing callers pass `!requested_reviewers.is_empty()` into `aggregate_review_status`, whose signature does not change.

This is the only way the requested lists reach persistence without dragging `pr_details_result` downstream, and it removes a flag that was computed for one yes/no question.

*Alternative considered:* carry `pr_details_result` into `PollSinglePrResult`. Rejected: it widens a result struct with a whole raw GitHub payload so that one consumer can re-parse two fields.

### Build the list in one pure function next to `aggregate_review_status`

`build_pr_reviewers(reviews, requested) -> Vec<PrReviewer>` in `github_client/reviews.rs`, which is already the home of review reduction and its unit tests.

Rules, all spec-driven:

- Latest review per reviewer that carries a decision wins. Reviews with no decision only produce `commented`.
- A reviewer present in `requested_reviewers` is `pending`, even when they already approved. A re-request outranks an old verdict.
- A dismissed approval yields `dismissed`, not `pending` and not `approved`.
- `requested_teams` entries become one `kind: team` row each, always `pending`.
- `kind: bot` comes from the GitHub user object's `type` field, read from the flattened `extra` JSON.

### Persist inside `persist_review_status`, only on a successful review fetch

`persist_review_status` already returns early when `result.reviews` is `None`. Writing reviewers in the same place gives the spec's "keep the last known reviewers when sync fails" rule for free, with no extra guard.

### Order and label in shared TypeScript presentation, not in the component

`getPrReviewerRows(pr)` in `packages/plugin-sdk/src/prStatusPresentation.ts`, beside `getPrStatusChips`. It parses the JSON field, sorts `changes_requested` then `pending` then `commented` and `dismissed` then `approved`, and maps each state to a label and a `StatusBadge` status.

Ordering is observable behaviour, so it belongs in a unit-tested pure function rather than in markup. Putting it in the shared package keeps the card dumb and lets a later surface reuse it without a second sort.

*Alternative considered:* sort in Rust and store ordered. Rejected: ordering is a presentation rule, and storing it would force a re-poll to change how the list reads.

### Serialize as a string field, parse in presentation

`PullRequestInfo.reviewers` is `string | PrReviewer[] | null`, matching how `merge_readiness_blockers` and `allowed_merge_methods` already type the same round trip. Rust sends the raw JSON text; `getPrReviewerRows` accepts either form.

## Risks / Trade-offs

- **Column index drift.** `read_pr_row` reads `pull_requests` by positional index and `unaddressed_comment_count` is a trailing computed column in two hand-written SELECTs. → Add `reviewers` to both SELECTs and to `read_pr_row` in the same commit, keeping the computed column last; the existing db tests for PR reads catch a mismatch.
- **Rust and TypeScript shapes are aligned by hand.** No parity test covers `PrRow` against `PullRequestInfo`. → Keep the field name and the serialized state strings identical on both sides, and cover the round trip with a db test plus a presentation test over the same JSON literal.
- **Stale verdicts after a push.** GitHub may dismiss approvals when new commits land; the card shows the previous verdicts until the next poll. → Accepted. `review_status` already behaves this way, and diverging would confuse the chip and the list.
- **A long reviewer list makes the card tall.** → The card is already collapsible per pull request, and the block sits below the signals row so the identity row stays short.
- **Team rows always read `pending`.** GitHub reports a team request, and a member's individual review arrives as that person, not as the team. A reviewed team can therefore show `pending` next to the member who reviewed. → Accepted and honest: the team request is genuinely still open until GitHub clears it.

## Migration Plan

1. Ship the guarded additive migration. Existing rows get NULL and the card omits the block until the next poll fills it.
2. The next scheduled poll populates reviewers for every open task pull request. No backfill job, no forced sync.
3. Rollback is a revert. The column stays behind, unread, and an older build ignores it. No down migration is needed because nothing else reads the column.
