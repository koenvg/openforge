## Why

Opening a pull request currently clears its unread signal without recording whether the user finished reviewing it. The Review Requests list therefore cannot distinguish work that still needs a first review, work already reviewed, and work that changed after review.

## What Changes

- Let users mark the current version of an open pull request as reviewed and reverse that choice.
- Mark the current version reviewed after OpenForge successfully submits a GitHub review.
- Treat a new head commit as an update since review, returning the pull request to the visible work list without losing the earlier review marker.
- Separate open pull requests that still need attention from reviewed pull requests, with the Reviewed group collapsed by default.
- Present review progress independently from unread state, CI state, and the existing merged or closed state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-request-status-signals`: Add user-controlled, revision-aware review progress and its presentation on the Review Requests list.

## Impact

- The persisted review-request record and shared `ReviewPullRequest` contract gain revision-aware reviewed state.
- The GitHub review command boundary gains operations to mark and unmark a pull request version as reviewed.
- The GitHub Sync review list, pull request cards, counts, keyboard navigation, and successful review-submission path consume the new state.
- Database migrations, Rust and TypeScript contract checks, and review-list component tests require updates.
