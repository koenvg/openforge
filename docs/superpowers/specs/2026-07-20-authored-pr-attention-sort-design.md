# Sort "My Pull Requests" by attention and draft state

## Problem

The "My Pull Requests" column of the PR Review view lists authored pull requests in
`updated_at DESC` order within each repository section. Recency is a poor proxy for
urgency: a draft nobody is waiting on can sit above an active PR with a merge conflict
purely because it was pushed more recently. The author has to scan every card to find
the ones that need work.

## Goal

Within each repository section of the authored list, surface pull requests that need the
author's attention, and sink drafts.

## Scope

Applies to the authored ("My Pull Requests") column only, in both the project-scoped
`pr_review` view and the all-repos `pr_review_global` view. Both are the same component
(`PrReviewView.svelte`), so one change covers both.

Out of scope: the "Review Requests" column, repository section ordering, and the
backend query order.

## Behaviour

### Ordering within a repository section

Pull requests are ranked into four bands, top to bottom:

| Band | Contents |
| ---- | -------- |
| 1 | Active, needs attention |
| 2 | Active, no attention needed |
| 3 | Draft, needs attention |
| 4 | Draft, no attention needed |

Draft state is the primary key; attention is the secondary key. Within a band the
existing relative order is preserved, so cards remain most-recently-updated first.

### "Needs attention"

A pull request needs attention when it is open and at least one of:

- It conflicts with its base branch — `mergeable_state` is `dirty` or `conflicting`,
  as determined by the existing `hasMergeConflicts` helper in
  `packages/plugin-sdk/src/domain.ts:262`.
- Its checks failed — `ci_status === 'failure'`.
- A reviewer requested changes — `review_status === 'changes_requested'`.

Checks still running (`ci_status === 'pending'`) and awaiting review
(`review_status === 'review_required'`) are normal states, not attention states. A PR
that is not open never needs attention, which follows from `hasMergeConflicts` and is
applied uniformly to the other two triggers.

### The `DO NOT REVIEW` label

`sortDoNotReviewLast` currently sinks labelled PRs to the bottom of both columns. That
label is a signal to reviewers, not to the author, so it is **ignored entirely** when
ordering the authored list. A labelled PR falls into one of the four bands on its own
draft and attention state. The label chip continues to render on the card.

The review column keeps its existing `DO NOT REVIEW` behaviour, unchanged.

### Repository section ordering

Sections keep their current ordering, which falls out of `Map` insertion order: a
section appears at the position of its most recently updated PR.

Because `sortDoNotReviewLast` currently runs *before* grouping, removing it from the
authored side can shift a section in one edge case — where a repository's most recently
updated PR carries the `DO NOT REVIEW` label, that section previously sank and now sits
at its true recency position. This is accepted as the more correct behaviour.

## Implementation

### `packages/pr-review-ui/src/prSort.ts`

Add two exports alongside the existing `sortDoNotReviewLast`:

- `authoredPrNeedsAttention(pr)` — the predicate above.
- `sortAuthoredPrs(prs)` — returns a new array ordered by the four bands, stable within
  each band, without mutating the input.

Both are structurally typed on the fields they read (`state`, `draft`,
`mergeable_state`, `ci_status`, `review_status`). `ReviewPullRequest` carries neither
`ci_status` nor `review_status`, so the comparator cannot be applied to the review list
by mistake — the type checker rejects it.

Implemented as a rank function plus a stable sort, rather than four partition passes, so
adding or reordering bands later touches one expression.

### `plugins/github-sync/src/review/pr/PrReviewView.svelte`

- Line 148: `sortedAuthoredPrs` no longer wraps `filteredAuthoredPrs` in
  `sortDoNotReviewLast`. Line 147 (`sortedReviewPrs`) is untouched.
- Line 249: `groupAuthoredByRepo` produces the sections as it does today; each
  section's array is then passed through `sortAuthoredPrs`. Sorting after grouping is
  what keeps section order independent of the new ranking.

No change to `PrReviewListSection.svelte`, `AuthoredPrCard.svelte`, the plugin SDK
domain types, or the Rust query.

## Testing

TDD, in `packages/pr-review-ui/src/prSort.test.ts`:

- Each band boundary: active-attention above active-normal, active-normal above
  draft-attention, draft-attention above draft-normal.
- Each attention trigger in isolation: merge conflict, failed checks, changes
  requested — each promotes a PR above a healthy sibling.
- Non-triggers: pending checks and `review_required` do not promote.
- A closed or merged PR is never treated as needing attention.
- Stability: PRs sharing a band keep their input order.
- The input array is not mutated.
- A `DO NOT REVIEW` label does not affect authored ordering — an active labelled PR
  still outranks a draft.

Per project convention these are business-logic assertions only; no CSS or styling
assertions.

## Follow-up

`hasDoNotReviewLabel` exists twice with divergent implementations —
`packages/pr-review-ui/src/prSort.ts:13` (`labels?: PrLabel[] | null`, lowercased) and
`packages/plugin-sdk/src/domain.ts:816` (`labels: PrLabel[]`, uppercased). Behaviourally
equivalent, independently maintained. Worth consolidating, but outside this change.
