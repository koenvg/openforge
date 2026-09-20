## 1. Thread identity in the cached comment store

- [x] 1.1 Parse `in_reply_to_id` on the poller's `ReviewComment` and carry it through `PrComment` in `src-tauri/src/github_client/types.rs`, mapping issue comments and review summaries to `None`; verify with focused Rust tests for all three comment types
- [x] 1.2 Add nullable `in_reply_to_id` storage to the `pr_comments` base schema and a guarded post-migration schema repair in `src-tauri/src/db/migrations.rs` without advancing `user_version`; verify with a migration test that an older database gains the column, keeps its rows and version, and remains readable by the older schema's queries
- [x] 1.3 Thread the column through `insert_pr_comment`, `PrCommentRow`, and both comment selects in `src-tauri/src/db/pull_requests/`; verify with a focused Rust test that inserts a reply and reads its parent back
- [x] 1.4 Write the reply parent from the poller on insert and atomically refresh it with the GitHub-owned outdated state for existing rows; verify with a poller persistence test that a cached row gains its parent on the next read while its `addressed` value remains unchanged
- [x] 1.5 Expose the reply parent on the comment payload returned by `get_pr_comments`; verify with an `app_invoke` test that reads a root and reply through the command boundary

## 2. Public contract and diff threading

- [x] 2.1 Add required `in_reply_to_id: number | null` to `PrComment` in `packages/plugin-sdk/src/domain.ts` and update every repository-owned constructor or fixture; verify with `pnpm packages:contract:check` and `pnpm exec tsc --noEmit`
- [x] 2.2 Pass the cached reply parent through `prCommentsToReviewComments` instead of hardcoding `null`; verify with a focused diff viewer test that a cached reply groups beneath its parent rather than becoming a second root card

## 3. Affected-system validation

- [x] 3.1 Run the Rust sidecar's full test, Clippy, and check commands from its crate root; verify all pass
- [x] 3.2 Run the plugin SDK contract check, diff viewer tests, project TypeScript check, and lint; verify all pass
