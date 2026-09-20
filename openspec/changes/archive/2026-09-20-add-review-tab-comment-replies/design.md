## Context

See proposal.md, Why.

The Review tab reads comments from the local `pr_comments` cache. That cache carries `addressed` and `outdated`, but not GitHub's `in_reply_to_id`. The adapter in `packages/pr-review-ui/src/diffComments.ts` therefore hardcodes every cached comment as a thread root even though the shared diff viewer already knows how to group replies.

The poller inserts comments it has not seen before and refreshes `outdated` on existing rows. Without another refresh field, comments cached before this change would remain unthreaded forever.

## Goals / Non-Goals

**Goals:**

- Keep the Review tab on its existing cached comment source.
- Preserve reply identity from GitHub through SQLite, the sidecar payload, the public SDK type, and the diff adapter.
- Heal existing cached rows on their next scheduled read without touching local addressed state.
- Keep the schema change safe for older OpenForge builds.

**Non-Goals:**

- Adding a reply composer or posting replies.
- Changing addressed-state or unaddressed-count rules.
- Changing the comment list outside the diff.
- Changing the GitHub Sync review view.

## Decisions

### 1. Extend the cached store

Add nullable `in_reply_to_id` storage to `pr_comments` and keep the Review tab on `getPrComments`. Reading GitHub live was rejected because that payload lacks the local `addressed` and `outdated` fields and would introduce a second comment source for the same view.

The poller's review-comment payload maps GitHub's `in_reply_to_id` into the cached `PrComment`. General pull request comments and review summaries always map it to `None` because GitHub does not thread those comment types.

### 2. Refresh reply identity for every fetched comment

Write the reply parent on insert and refresh it atomically with the existing GitHub-owned `outdated` state. This makes the next scheduled read repair pre-existing cache rows while leaving the local `addressed` state untouched.

A migration-time backfill was rejected because the database does not contain enough information to reconstruct parent relationships. Re-linking or clearing local data is also unnecessary once the poller refreshes the field.

### 3. Use an additive nullable column without advancing `user_version`

Add `in_reply_to_id INTEGER` to the base schema and use a guarded schema-repair function after the versioned migrations for existing databases. Do not append a versioned migration, rebuild the table, or rename `pr_comments`.

Appending a versioned migration would raise SQLite's `user_version`, which makes the previous build reject the database as too far ahead. The schema-repair path leaves `user_version` unchanged. SQLite readers tolerate columns they do not select, so the previous build can open the upgraded database. A nullable field also represents thread roots without rewriting existing rows.

### 4. Make reply identity required at the SDK boundary

Add `in_reply_to_id: number | null` to the public `PrComment` type. Keeping the field required forces plugin code and fixtures that construct comments to state whether each comment is a root or reply. Making it optional was rejected because an omitted parent would silently flatten a thread.

The renderer payload uses the same snake_case key as the existing public contract. The Rust command boundary derives its camelCase handling through the project's established serialization rules where applicable.

### 5. Reuse the diff viewer's existing grouping

Change `prCommentsToReviewComments` to pass through `in_reply_to_id` instead of hardcoding `null`. The shared diff viewer already groups `ReviewComment` values by this field, so no new UI component or reply behavior is needed.

## Risks / Trade-offs

**Existing threads remain flat until the next scheduled read.** The poller repairs them on its normal cadence. This avoids a separate migration-time network operation.

**The required SDK field breaks constructors and fixtures.** Update every repository-owned construction site and run the package contract and TypeScript checks.

**Migration compatibility depends on staying additive and keeping `user_version` stable.** Test an older-schema database through the repair and verify its rows and version remain readable. Keep all existing columns and table names unchanged.

## Migration Plan

1. Add the nullable column to the base schema and guarded post-migration schema repair.
2. Ship parsing, persistence, existing-row refresh, query, and payload changes in the same release.
3. Ship the SDK field and cached-comment adapter change with the sidecar changes.

Rollback leaves the extra nullable column in place. Older builds ignore it, and no existing data needs to be removed or transformed.
