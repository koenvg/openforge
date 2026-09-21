## 1. Persist revision-aware review progress

- [x] 1.1 Add failing migration tests for new and upgraded databases, then add nullable `reviewed_head_sha` to `review_prs`; verify the migration tests prove existing rows start unreviewed and rollback remains valid.
- [x] 1.2 Add failing database tests for mark, clear, head-change retention, and unread independence, then implement the `ReviewPrRow` field and database operations; verify the focused Rust review database tests pass.
- [x] 1.3 Extend the shared `ReviewPullRequest` contract, test fixtures, and Rust serialization with `reviewed_head_sha`; verify TypeScript contract tests and the focused Rust row serialization tests agree on the nullable field.

## 2. Expose reviewed-state commands

- [x] 2.1 Add failing runtime and app-invoke tests for marking `{ prId, headSha }` reviewed and clearing `{ prId }`, then implement both Rust command paths with camelCase payloads and `Result<T, String>` boundaries; verify reviewed commands leave viewed fields unchanged.
- [x] 2.2 Register the commands through the desktop IPC registry and GitHub Sync backend client, then add client and generated-contract tests; verify `pnpm electron:contract:check` and the focused GitHub Sync client tests pass.

## 3. Derive and present review progress

- [x] 3.1 Add failing presentation tests for `Review needed`, `Reviewed`, `Updated since review`, and terminal-state precedence, then implement one shared review-progress helper; verify the Plugin SDK presentation suite passes.
- [x] 3.2 Add failing `ReviewPrCard` tests for the text status, `Mark reviewed`, and `Mark as needs review` controls, then implement the accessible badge and persistent actions before the CI signal; verify the controls do not open the card and never rely on color alone.
- [x] 3.3 Add failing list-model tests for needs-review, reviewed, and finished partitions, per-group counts, repository grouping, and action-oriented keyboard scope, then implement those derived collections; verify a reviewed head change moves only that row back to Needs your review.
- [x] 3.4 Add failing component tests for the collapsed Reviewed group, expansion, manual mark and undo, and Finished precedence, then render the new group and wire optimistic updates with persistence-failure recovery; verify unread dots and mark-unread behavior remain independent.
- [x] 3.5 Update the Review Requests Storybook fixtures and story for all review-progress states and the default-collapsed Reviewed group; verify the story interaction assertions pass and visually inspect the card hierarchy, status text, focus behavior, and constrained-width layout.

## 4. Mark successful in-app reviews

- [x] 4.1 Add failing review-controller tests showing a successful GitHub review marks its submitted commit reviewed before returning to the list, then implement the mark through the shared command; verify keeping the PR moves it into Reviewed while removing it still hides it.
- [x] 4.2 Add failing tests for recovered inline-comment submission, a concurrent head change, and local mark failure after GitHub success, then implement those branches; verify stale commits report Updated since review and local failure never prompts a duplicate GitHub submission.
- [x] 4.3 Update the post-review dialog feedback for the keep path and local-status failure where needed; verify component tests tell the user where a kept review went and distinguish GitHub success from local tracking failure.

## 5. Validate affected systems

- [x] 5.1 Run the complete frontend, Plugin SDK, PR Review UI, and GitHub Sync checks with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm plugin-host:typecheck`, `pnpm --filter @openforge-app/plugin-sdk build`, `pnpm --filter @openforge-app/plugin-sdk check:contract`, `pnpm --filter @openforge-app/pr-review-ui check`, `pnpm --filter @openforge-app/plugin-github-sync typecheck`, and `pnpm --filter @openforge-app/plugin-github-sync build`; verify every command passes or record an unrelated failure with evidence.
- [x] 5.2 From the backend crate root, run `cargo test`, `cargo check`, and `cargo clippy`; verify the database migration, command boundary, polling reconciliation, and review submission suites pass or record an unrelated failure with evidence.
- [x] 5.3 Run `pnpm storybook:visual:check`, inspect every changed Review Requests capture, and update approved baselines only for intentional reviewed-state and grouping changes; record the reviewed scenarios and any remaining visual coverage gap.
