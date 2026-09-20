## 1. Store the signals

- [x] 1.1 Append a guarded additive migration adding nullable `ci_status TEXT` and `merged_at INTEGER` to `review_prs`, copying the shape of the existing `mergeable` and `mergeable_state` migrations, and verify with `cargo test migration` that a fresh database and an already-migrated database both end with both columns
- [x] 1.2 Add `ci_status: Option<String>` and `merged_at: Option<i64>` to `ReviewPrRow` and to the `get_all_review_prs` SELECT, and verify `cargo test review` passes
- [x] 1.3 Replace the 20 positional arguments of `upsert_review_pr` with a `ReviewPrUpsert` struct carrying the new fields, update both existing call sites, and verify `cargo check` passes from the backend crate root
- [x] 1.4 Write check state through `COALESCE(excluded.ci_status, review_prs.ci_status)` and verify a round-trip test proving that an upsert carrying `None` leaves a previously stored check state intact while an upsert carrying a value replaces it

## 2. Share the check signal fetch

- [x] 2.1 Extract the paired `get_check_runs` and `get_combined_status` fetch reduced by `aggregate_ci_status` out of `authored_pr_sync::enrich_authored_pr` into a shared helper, and verify the existing `cargo test authored_pr` suite still passes unchanged
- [x] 2.2 Verify with a unit test that the helper returns passing for all-successful checks, failing for one unsuccessful check, running for an incomplete check, and no state when the commit has neither checks nor statuses
- [x] 2.3 Verify with a unit test that the helper reports no state rather than an error when either endpoint fails, so a caller can keep the last known value

## 3. Resolve merge state for kept entries

- [x] 3.1 Add a database read selecting review-request rows where `review_requested = 0 AND state = 'open' AND dismissed_at IS NULL`, and verify a test proving requested rows, already-terminal rows, and dismissed rows are all excluded
- [x] 3.2 Add a database write setting a review request's `state` and `merged_at` from a resolved terminal state, and verify a round-trip test proving a merged pull request stores a `merged_at` and a closed one stores none
- [x] 3.3 Add `reconcile_kept_review_prs`, reusing the terminal-state derivation shape of `terminal_state_for_pr_details`, and verify unit tests proving a merged detail response marks the row merged, a closed-unmerged one marks it closed, an open one leaves it untouched, and a failed fetch leaves it open and on the list
- [x] 3.4 Verify with a test that a row written to a terminal state is absent from the next candidate read, so the reconcile does not re-fetch it forever

## 4. One sync path for both callers

- [x] 4.1 Add `src-tauri/src/review_pr_sync.rs` owning enrich-and-persist for review requests, best-effort, calling the shared check helper and then the reconcile, mirroring `authored_pr_sync::enrich_and_persist_authored_prs`
- [x] 4.2 Replace the copied upsert loop in `github_runtime/polling.rs` `fetch_review_prs` with a call to the new module, and verify `cargo test review_pr` passes
- [x] 4.3 Replace the copied upsert loop in `github_poller/review_sync.rs` `poll_review_prs` with a call to the same module, keeping the unread-count event emission, and verify the existing poller tests still pass
- [x] 4.4 Verify with a test that both entry points persist the same check state and merge state for the same GitHub responses

## 5. Carry the fields to the renderer

- [x] 5.1 Add `ci_status: string | null` and `merged_at: number | null` to `ReviewPullRequest` in the plugin SDK domain types, matching the Rust field names, and verify `pnpm exec tsc --noEmit` passes
- [x] 5.2 Verify with a `getPrStatusChips` test over a review pull request shape that a passing, failing, and running check state each yield the expected compact chip, that a merged pull request yields only a merged chip, and that a closed unmerged one yields only a closed chip
- [x] 5.3 Verify with a `ReviewPrCard` component test that the card renders the check chip and the merge chip without any change to the card itself

## 6. Validate the change

- [x] 6.1 Run `cargo test`, `cargo clippy`, and `cargo check` from the backend crate root and confirm no new failures or warnings
- [x] 6.2 Run `pnpm test packages/plugin-sdk`, `pnpm test packages/pr-review-ui`, and `pnpm test plugins/github-sync` and confirm the new and existing suites pass
- [x] 6.3 Run `pnpm exec tsc --noEmit` and confirm the Rust and TypeScript review pull request shapes agree
- [x] 6.4 Open the Pull Requests page in the running app and confirm a review request shows the same check chip GitHub shows, and that a review request merged from GitHub reads as merged after the next poll
