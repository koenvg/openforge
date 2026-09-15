## 1. Store the reviewer list

- [x] 1.1 Define `PrReviewer { login, kind, state }` with serde in the GitHub client types, plus the `kind` and `state` string vocabularies from design.md, and verify `cargo check` passes from the backend crate root
- [x] 1.2 Append a guarded additive migration that adds a nullable `reviewers` TEXT column to `pull_requests`, copying the `labels` migration shape, and verify with `cargo test migration` that a fresh database and an already-migrated database both end with the column
- [x] 1.3 Add `reviewers: Option<String>` to `PrRow`, to `read_pr_row`, and to both hand-written `pull_requests` SELECT statements, keeping `unaddressed_comment_count` last, and verify `cargo test pull_request` passes
- [x] 1.4 Add a database write for the reviewers column and a round-trip test proving a non-empty list persists and an empty list clears the column to NULL, mirroring the authored PR labels round-trip test

## 2. Derive reviewers in the sidecar

- [x] 2.1 Add `build_pr_reviewers(reviews, requested)` beside `aggregate_review_status` and verify unit tests cover: latest decision per reviewer wins, changed mind lands on approved, comment-only yields commented, dismissed approval yields dismissed, re-requested approver yields pending, team request yields one pending team row, and bot `type` yields `kind: bot`
- [x] 2.2 Replace `has_requested_reviewers: bool` with `requested_reviewers: Vec<RequestedReviewer>` on `RestReadinessSources` and `PollSinglePrResult`, parse `requested_reviewers` and `requested_teams` where the old bool was derived, pass `!is_empty()` into `aggregate_review_status`, and verify the existing poller readiness tests still pass
- [x] 2.3 Write the reviewer list inside `persist_review_status` so it is skipped when the review fetch failed, and verify a poller persistence test proves a failed review fetch leaves the stored reviewers untouched

## 3. Carry reviewers to the renderer

- [x] 3.1 Add `reviewers` to `PullRequestInfo` in the plugin SDK domain types with the same field name and state strings as the Rust side, and verify `pnpm exec tsc --noEmit` passes
- [x] 3.2 Add `getPrReviewerRows(pr)` to the plugin SDK PR status presentation, parsing the string or array form, sorting changes requested then pending then commented and dismissed then approved, and mapping each state to a label and a status badge status
- [x] 3.3 Verify `getPrReviewerRows` with unit tests covering the spec's ordering scenario, an empty and a null field yielding no rows, and a malformed JSON field yielding no rows rather than throwing

## 4. Show reviewers in the task card

- [x] 4.1 Render a Reviewers block in `PullRequestCard.svelte` above Pipeline checks, one row per reviewer using the same status-icon and label row shape, hidden when `getPrReviewerRows` returns nothing
- [x] 4.2 Give each row an accessible name carrying both the reviewer identity and the verdict, and verify a component test reads identity and verdict back for each row
- [x] 4.3 Verify with a component test that a pull request with no reviews and no requests renders no Reviewers block and no placeholder

## 5. Validate the change

- [x] 5.1 Run `cargo test`, `cargo clippy`, and `cargo check` from the backend crate root and confirm no new failures or warnings
- [x] 5.2 Run `pnpm test plugins/github-sync` and `pnpm test packages/plugin-sdk` and confirm the new and existing suites pass
- [x] 5.3 Run `pnpm exec tsc --noEmit` and confirm the Rust and TypeScript pull request shapes agree
- [ ] 5.4 Open a task with a linked pull request in the running app and confirm the block matches GitHub for a pull request that has an approval, a changes-requested review, and a pending reviewer
