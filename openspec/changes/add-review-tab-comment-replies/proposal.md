## Why

GitHub review comments are read-only in the Review tab. Answering a reviewer means leaving the app for github.com and coming back. The reply box already exists in the shared diff viewer, and the GitHub write already exists in the sidecar; the Review tab never connects them.

The cached comment store is also flat. It records no reply parent, so a posted reply would land as a stray sibling card instead of under the comment it answers, and "unaddressed" would grow by one every time you speak.

## What Changes

- Record the reply parent for each cached pull request comment, so comments form threads instead of a flat list.
- Offer a reply box on inline code comments in the Review tab diff. Posting sends a threaded reply to GitHub.
- Persist the posted reply from GitHub's response at post time, so it appears under its parent without waiting for the next poll.
- Mark a comment addressed when the user replies to it. A later reply from anyone else returns that comment to unaddressed.
- Count only thread roots authored by someone other than the signed-in user towards the unaddressed comment counts behind pull request badges and project attention. The user's own comments and replies stop counting.
- Hide replies from the left-hand comment list. They stay visible inline under their parent.
- **BREAKING** The public `PrComment` SDK type gains a required reply-parent field, so plugin code and fixtures that build one must supply it.

Out of scope, deliberately:

- A reply box for general pull request comments and review summaries. GitHub offers no threading on either, so a reply there is a new top-level comment that needs a second addressed model. No write path for those comments exists yet.
- A reply box in the left-hand comment list. Replies are offered inline only.
- Queuing replies into a pending review submission, the way the GitHub Sync review view does. In the Review tab the user is answering their own reviewers one comment at a time.
- Resolving the GitHub review thread. Addressed stays a local flag.

## Capabilities

### New Capabilities

- `review-comment-replies`: Replying to a GitHub review comment from the Review tab. Covers thread identity in the cached comment store, which comments accept a reply, what the user sees immediately after posting, and how replying and later reviewer answers move a comment in and out of the unaddressed counts.

### Modified Capabilities

None. `self-review-workspace` governs the review panel layout and the Send feedback action, neither of which changes.

## Impact

- SQLite: a reply-parent column on `pr_comments` and an additive migration. Rows synced before the migration gain their parent on the next poll rather than through a backfill pass.
- Unaddressed comment counts change meaning in three queries: open pull requests, per-task pull requests, and project attention. Badges and attention numbers drop for anyone whose own comments were being counted.
- Public Plugin SDK: `PrComment` gains a field.
- New core renderer command for posting a review comment reply, in the existing `github-review` domain.
- The GitHub client reply call starts reading its response instead of discarding it.
- `packages/pr-review-ui`: the cached-comment adapter stops hardcoding a null reply parent.
- Rust sidecar tests, poller tests, diff viewer tests, and Review tab tests.
