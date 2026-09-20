## Why

The Review Requests list already renders a status chip row, but the row is always empty. OpenForge caches no CI state and no merge state for a pull request that someone asked you to review. The My Pull Requests list beside it shows both. The review list is also sticky, so a pull request stays on it after it merges and still reads as open work.

## What Changes

- A pull request in the Review Requests list reports its CI state: passing, failing, or running.
- A pull request in the Review Requests list reports that it merged, or that it closed without merging.
- A review request that merged or closed no longer reads as open work, so a stale sticky entry is recognisable without opening GitHub.
- The chip row, its wording, and its order are unchanged. This change supplies the data the row already asks for.
- Reviewer-approval state on the review list (Approved, Needs Review, Changes Req.) is a non-goal. The enrichment pass makes it a small addition later if wanted.

## Capabilities

### New Capabilities
- `review-request-status-signals`: the CI state and terminal merge state OpenForge reports for a pull request in the Review Requests list, and how those stay in step with GitHub.

### Modified Capabilities

(none)

## Impact

- GitHub sync in the Rust sidecar: the review-request search already fetches per-pull-request detail, but no checks. CI needs the two check endpoints the authored list already calls. Both are ETag-conditional, so an unchanged head commit costs no rate limit.
- Merge state needs a detail fetch for entries that left the open search. This mirrors the stale-reconcile step the task pull requests already run.
- SQLite: the cached review-request rows need to carry CI state and a merged timestamp.
- Pull request contract shared with plugins: new fields on the review pull request shape.
- Both review-request write paths, the manual Refresh and the background poll, duplicate the upsert today and both need the new fields.
- The review card chip row and the attention overview need no change.
- Out of scope: the authored list, the task pull request card, and dropping merged entries from the list.
