## Context

The Review Requests list is backed by the host-owned `review_prs` SQLite table and exposed to the GitHub Sync plugin through the shared `ReviewPullRequest` contract. The table already keeps head SHA, viewed state, dismissal state, and open rows that no longer appear in GitHub's review-requested search. Opening a card writes `viewed_head_sha`; a head change clears that unread acknowledgement. Review completion has no separate field.

The GitHub Sync plugin partitions open and finished rows, renders the shared `ReviewPrCard`, and submits GitHub reviews through a host command. Successful submission currently opens a keep-or-remove dialog. The new behavior crosses SQLite, Rust commands, the plugin contract, shared status presentation, and the Svelte list model, so it needs an explicit design.

## Goals / Non-Goals

**Goals:**

- Keep one durable reviewed revision per sticky review-request row.
- Derive review progress consistently in list grouping, cards, and submission flows.
- Preserve the existing unread, removal, CI, walkthrough, and terminal-state behaviors.
- Prevent a stale card or review submission from marking a newer, unseen head as reviewed.

**Non-Goals:**

- Import review history submitted outside OpenForge.
- Change GitHub review requests, approvals, or review decisions when the local mark changes.
- Change the project rail and sidebar badges, which remain unread counts.
- Change the existing keep-or-remove choice after an in-app GitHub review.

## Decisions

### Persist the reviewed head on the host-owned review row

Add nullable `reviewed_head_sha` to `review_prs`, `ReviewPrRow`, and `ReviewPullRequest`. Existing rows start with `NULL`; opening a PR is not evidence that it was reviewed. Review sync updates `head_sha` but deliberately keeps `reviewed_head_sha`, so a mismatch records that the author changed the PR after review.

The three open-PR states derive from the pair of fields:

- `reviewed_head_sha IS NULL`: `Review needed`
- `reviewed_head_sha = head_sha`: `Reviewed`
- `reviewed_head_sha != head_sha`: `Updated since review`

Terminal state takes precedence. Merged and closed rows remain in Finished and do not also present review progress.

This state belongs in SQLite rather than plugin storage because the host already owns sticky review-request identity and reconciliation. One host value also keeps project-scoped and all-repositories views consistent.

Alternative considered: infer completion from `viewed_head_sha`. Rejected because opening a PR acknowledges unread work but does not finish a review.

Alternative considered: fetch the authenticated user's GitHub reviews. Rejected because the agreed workflow is an explicit local mark, must work without more GitHub requests, and must not import external review history.

### Use revision-bearing commands for manual state changes

Add typed host commands to mark a review request reviewed with `{ prId, headSha }` and to clear its reviewed mark with `{ prId }`. The mark command stores the supplied SHA, not whatever head happens to be current in SQLite. If the renderer acted on a stale card, the stored and current heads differ and the row correctly becomes `Updated since review` after refresh instead of falsely reporting the newer head as reviewed.

The GitHub Sync controller updates its stores optimistically and rolls back or refreshes when persistence fails. These commands do not mutate unread state and do not call GitHub.

Alternative considered: store only a boolean. Rejected because a boolean cannot detect new commits or distinguish a stale action from review of the current head.

### Mark the submitted commit after an in-app GitHub review

After GitHub accepts a review, the review controller invokes the same mark-reviewed command with the submitted `commitId` before returning to the list. The recovery path that proves inline comments were already submitted does the same. Recording the submitted SHA rather than the latest cached head makes a concurrent author push show `Updated since review`.

The GitHub submission and local SQLite write cannot be one transaction. If GitHub succeeds but the local mark fails, the UI must report that the review was submitted and that only the local status update failed. It must not invite the user to resubmit the GitHub review. The persistent manual action remains the recovery path.

Alternative considered: hide this inside the GitHub submission command. Rejected because a post-request database failure would make the command look like the GitHub submission failed and could encourage a duplicate review.

### Derive presentation through one shared helper

Add a pure review-progress helper beside the existing pull request status presentation utilities. Both `ReviewPrCard` and the GitHub Sync list partition use it, so badge text and grouping cannot drift. The progress badge appears before CI status and always contains text. The card exposes a persistent `Mark reviewed` action for work items and `Mark as needs review` for reviewed items.

The list partitions open rows into:

- `Needs your review`: `Review needed` and `Updated since review`
- `Reviewed`: current head matches the reviewed head
- `Finished`: existing merged and closed rows

The Reviewed group starts collapsed on each new view mount and shows its own count. The existing Finished group and repository grouping remain. Action-oriented keyboard navigation stays on the visible Needs your review rows, matching the current exclusion of Finished rows; reviewed cards remain reachable through normal keyboard focus after expansion.

Alternative considered: leave one list and add badges only. Rejected because the user's primary need is to see outstanding work without scanning every card.

### Keep review completion independent from unread state

`viewed_at` and `viewed_head_sha` continue to drive unread dots, mark-unread actions, and project badges. Manual review completion does not change those fields. A new head may therefore be both unread and `Updated since review`, which expresses two separate facts rather than collapsing them into one signal.

## Risks / Trade-offs

- [A card disappears into a collapsed group immediately after marking] -> Update both group counts in the same optimistic state change, use explicit action text, and announce persistence failures without undoing GitHub work.
- [A new head arrives while a mark or review submission is in flight] -> Store the acted-on SHA and derive `Updated since review` from the mismatch.
- [GitHub review succeeds but local persistence fails] -> Treat GitHub submission as successful, show a local-status error, and leave the manual mark available.
- [The extra group makes list and keyboard state more complex] -> Derive all partitions from one progress helper and keep reviewed rows outside the action-oriented navigation list.
- [Existing users may expect opened PRs to remain lower in the list] -> Do not migrate viewed state into reviewed state; all open rows begin as review work until the user explicitly completes them.

## Migration Plan

1. Add `reviewed_head_sha` as a nullable, idempotent SQLite migration and expose it through the Rust and TypeScript review-request contracts.
2. Add reviewed-state database operations and typed host/plugin commands without changing existing rows.
3. Add shared state derivation, card actions, list partitioning, and submission integration.
4. Verify new and upgraded databases, command contracts, race behavior, component interaction, keyboard scope, and unread independence.

Rollback removes the new commands and presentation. The nullable column can remain unused or be removed by the migration rollback; losing it only returns all open pull requests to `Review needed`.
