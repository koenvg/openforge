## Why

The Review tab caches pull request comments without their reply relationship. A reviewer's reply therefore appears as a separate card beside the comment it answers instead of beneath it.

## What Changes

- Record the reply parent for every cached pull request comment.
- Refresh the reply parent for comments cached before this change on the next pull request read, without changing their addressed state.
- Render cached review replies beneath the comment they answer in the Review tab diff.
- Treat general pull request comments and review summaries as thread roots.
- **BREAKING** Add a required reply-parent field to the public `PrComment` SDK type.
- Keep the database migration additive so an older OpenForge build can still open the upgraded database.

This change does not add a reply composer or any way to post replies.

## Capabilities

### New Capabilities

- `review-comment-replies`: Preserve GitHub review comment relationships in the local cache and show existing threads correctly in the Review tab diff.

### Modified Capabilities

None.

## Impact

- SQLite: `pr_comments` gains a nullable reply-parent column through an additive migration.
- Rust sidecar: GitHub comment parsing, cached persistence, refreshes, queries, and renderer payloads carry the reply parent.
- Public Plugin SDK: `PrComment` gains a required reply-parent field.
- Shared diff viewer: the cached-comment adapter passes the stored reply parent into its existing thread grouping.
