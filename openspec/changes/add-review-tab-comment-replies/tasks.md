## 1. Thread identity in the cached comment store

- [ ] 1.1 Parse `in_reply_to_id` on the poller's `ReviewComment` and carry it through `PrComment` in `src-tauri/src/github_client/types.rs`, mapping issue comments and review bodies to `None`; verify with `cargo test` unit cases asserting the field survives `into_pr_comment` for a reply and is `None` for the other two types
- [ ] 1.2 Add the nullable `in_reply_to_id` column to the `pr_comments` base schema and an additive guarded migration in `src-tauri/src/db/migrations.rs`, following the `outdated` precedent at line 1510; verify with a migration test that an older database gains the column and keeps its rows
- [ ] 1.3 Thread the column through `insert_pr_comment`, `PrCommentRow`, and both comment selects in `src-tauri/src/db/pull_requests/`; verify with a `cargo test` case that inserts a reply and reads its parent back
- [ ] 1.4 Write the reply parent from the poller, both on insert and in the existing-row refresh loop beside `update_comment_outdated` (`src-tauri/src/github_poller/persistence.rs:108`); verify with a poller persistence test that a pre-existing row with a null parent gains it on the next read while its `addressed` value is untouched
- [ ] 1.5 Expose the reply parent on the comment payload the renderer receives in `src-tauri/src/github_runtime/pr_actions/mod.rs`; verify with an `app_invoke` test asserting `get_pr_comments` returns it

## 2. Contract surface

- [ ] 2.1 Add the required reply-parent field to `PrComment` in `packages/plugin-sdk/src/domain.ts` and fix every fixture that constructs one; verify with `pnpm packages:contract:check` and `pnpm exec tsc --noEmit`
- [ ] 2.2 Stop hardcoding `in_reply_to_id: null` in `prCommentsToReviewComments` (`packages/pr-review-ui/src/diffComments.ts:216`); verify with a `diffComments` test that a cached reply groups under its parent's line instead of rendering as its own entry
- [ ] 2.3 Add a `createReviewCommentReply` wrapper to `src/lib/ipc/github.ts` and its `github-review` entry to `src/lib/desktopIpcDomains.ts`, then regenerate the registry; verify with `pnpm electron:contract:check`

## 3. Reply write path

- [ ] 3.1 Return the created review comment from `GitHubClient::create_review_comment_reply` instead of discarding the response (`src-tauri/src/github_client/reviews.rs:141`); verify with a `cargo test` case that parses a realistic reply response including its id and reply parent
- [ ] 3.2 Add thread-root resolution over `pr_comments` using the recursive CTE from design.md, decision 5; verify with `cargo test` cases for a root, a direct reply, and a three-deep chain
- [ ] 3.3 Make the reply command post to GitHub, insert the returned comment, then mark the resolved thread root addressed (`src-tauri/src/github_runtime/comments.rs`); verify with an `app_invoke` test asserting all three effects from one call
- [ ] 3.4 Keep an accepted reply when the addressed write fails, without reporting a failed post; verify with a `cargo test` case that the reply row persists and the command reports success

## 4. Unaddressed count rule

- [ ] 4.1 Restrict both `unaddressed_comment_count` subqueries in `src-tauri/src/db/pull_requests/queries.rs` (lines 17 and 43) to thread roots not authored by the cached `github_username`; verify with `cargo test` cases covering a reviewer thread with replies, a comment authored by the signed-in user, and an uncached username
- [ ] 4.2 Apply the same restriction to the pull request attention subquery in `src-tauri/src/db/project_attention.rs:104`; verify with a `cargo test` case asserting it matches the per-pull-request count for the same data
- [ ] 4.3 Return a thread root to unaddressed when the poller inserts a reply authored by anyone other than the cached username; verify with a poller persistence test covering a reply from a reviewer and a reply from the signed-in user
- [ ] 4.4 Apply the same two clauses to the renderer's unaddressed set in `src/lib/useCommentSelection.svelte.ts:39`; verify with a focused Vitest run asserting the derived count matches the rule for replies and for own-authored comments

## 5. Reply in the Review tab

- [ ] 5.1 Add a reply handler to the Review tab's comment controller and pass `onReplyToExistingComment` from `src/components/task-detail/SelfReviewDiffPanel.svelte`, gated on a linked open pull request; verify with a Review tab test that submitting an inline reply calls the command with the pull request and comment
- [ ] 5.2 Show the posted reply under its parent from the command's response without a refresh, and surface an error that leaves the comment unaddressed and retryable when GitHub rejects the reply; verify with Review tab tests for both outcomes
- [ ] 5.3 Filter replies out of `src/components/shared/pr/PrCommentsList.svelte`; verify with a `PrCommentsList` test that a thread with two replies renders one entry

## 6. Full affected-system validation

- [ ] 6.1 Run `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify all pass
- [ ] 6.2 Run `cargo test`, `cargo clippy`, and `cargo check` from the backend crate root; verify all pass
- [ ] 6.3 Run the Self Review browser regression against the pages Storybook (`STORYBOOK_URL=http://localhost:6006 pnpm test storybook/stories/pages/SelfReview.browser.test.ts`); verify the review panel and Send feedback behaviour is unchanged
