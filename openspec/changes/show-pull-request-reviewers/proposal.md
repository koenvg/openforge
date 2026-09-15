## Why

A task's pull request card reports that review is needed, but never who is reviewing. To learn who already approved, who asked for changes, and who is still holding the pull request, a user has to leave the app and open GitHub.

## What Changes

- The pull request card in a task shows a reviewers list: every person, team, and bot that reviewed the pull request or was asked to review it.
- Each entry carries its own verdict: approved, changes requested, commented, dismissed, or pending.
- Entries that block the merge come first, so the card answers "who do I chase" without scanning.
- The card hides the list when the pull request has no reviews and no review requests.
- The existing review signal chip is unchanged. The list is additional detail, not a replacement.

## Capabilities

### New Capabilities
- `task-pull-request-reviewers`: who reviewed a task's pull request, what each one decided, and how that is presented in the task pull request card.

### Modified Capabilities

(none)

## Impact

- GitHub sync in the Rust sidecar: reviews and review requests are already fetched on every poll and then reduced to a single status word. The per-reviewer detail needs to survive instead of being discarded. No new GitHub API calls.
- SQLite: the cached task pull request rows need to carry the reviewer list.
- Pull request contract shared with plugins: one new field on the pull request shape.
- The `github-sync` plugin's task pull request card renders the list.
- Out of scope: the authored and review pull request lists keep their current presentation.
