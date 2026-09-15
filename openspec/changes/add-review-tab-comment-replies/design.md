## Context

See proposal.md, Why.

Two things about the current state drive every decision below.

**Most of the feature already exists, unwired.** The shared diff viewer renders a reply composer whenever it is handed an `onReplyToExistingComment` callback (`packages/pr-review-ui/src/InlineExistingComment.svelte:63`), and the sidecar already posts threaded replies (`src-tauri/src/github_runtime/comments.rs:272`). The Review tab passes the viewer its comments but no reply callback (`src/components/task-detail/SelfReviewDiffPanel.svelte:109`), and core has no renderer command for the write. The GitHub Sync review view is wired to both.

**There are two comment sources with different shapes.** The Review tab reads the cached `pr_comments` table through `getPrComments`, which carries the local `addressed` and `outdated` flags but no reply parent. The GitHub Sync review view reads GitHub live through `get_review_comments`, which carries the reply parent but neither flag. The adapter that feeds cached comments into the viewer hardcodes `in_reply_to_id: null` (`packages/pr-review-ui/src/diffComments.ts:216`), which is why cached comments can never thread.

## Goals / Non-Goals

**Goals:**

- One comment source for the Review tab, so its thread view, its `addressed` flag, its badges, and project attention cannot disagree.
- A reply that is visible the moment GitHub accepts it, without a second network read.
- One definition of "unaddressed", shared by the three SQL sites that compute it and by the renderer that filters the comment list.

**Non-Goals:**

- Any change to how the Review tab loads diffs, or to the review panel layout and Send feedback behaviour that `self-review-workspace` governs.
- Resolving the GitHub review thread. `addressed` stays local.
- Touching the GitHub Sync review view. It keeps its own live read and its own queued-reply flow.

## Decisions

### 1. Extend the cached store rather than read GitHub live

The Review tab keeps reading `pr_comments`, and that table gains a reply parent.

Reading live from `get_review_comments` needs no backend work at all, because `getReviewComments` is already a core wrapper (`src/lib/ipc/github.ts:115`) registered in `desktopIpcDomains.ts:115` and called from nowhere in `src/`. It was rejected anyway: the live payload has no `addressed` and no `outdated`, it covers only inline review comments, and it needs the network. The Review tab's local table exists precisely to hold `addressed` and `outdated`, and project attention already counts out of it, so a second source would let the tab and the badges disagree.

A hybrid that reads live for inline threads and cached for the comment list was also rejected. It works, and the join is exact because both sides key on the GitHub review comment id, but it leaves a reply invisible in the comment list until the next poll and gives one feature two sources.

### 2. Heal the reply parent on the next read instead of backfilling

The poller inserts only comments whose id it has not seen (`src-tauri/src/github_poller/persistence.rs:77`). Left alone, every already-cached comment would keep a null reply parent forever, because nothing updates an existing row except the `outdated` refresh a few lines below (`:108`).

The reply parent is written in that same refresh, for every fetched comment rather than only new ones. That loop already runs on each poll and already proves it can update an existing row without disturbing `addressed`, so no migration-time backfill and no forced re-sync is needed. Threads appear one poll after the update lands.

### 3. Persist the reply from the POST response

`GitHubClient::create_review_comment_reply` discards GitHub's response body and returns `Ok(())` (`src-tauri/src/github_client/reviews.rs:141`). GitHub returns the created review comment there, including its id and reply parent. Parsing it and inserting it makes the reply visible at post time, and the poller's existing id check dedupes it on the next read for free.

The alternatives were an optimistic renderer-only insert, which then has to be reconciled or rolled back, and triggering an immediate targeted re-poll, which costs a round trip to learn something the POST already told us.

### 4. Post, persist, and address in one command

The reply command does all three: posts to GitHub, inserts the returned comment, then marks the thread root addressed. It already holds the database handle for step two.

Splitting the addressed write into a second renderer call would make the common path two round trips that can half-fail. Since GitHub has already accepted the reply at that point, a failure there must not look like a failed reply, which is the behaviour the spec pins down.

### 5. Resolve the thread root with a recursive CTE

GitHub most likely normalises `in_reply_to_id` to the thread root for every reply in a thread, and the existing grouping code bets on it with a single-hop lookup (`packages/pr-review-ui/src/diffComments.ts:141`). That bet is cheap to lose in a display: the reply still renders. It is not cheap to lose in the addressed rule, which would silently mark the wrong comment.

Walking up in SQLite removes the assumption for about six lines:

```sql
WITH RECURSIVE up(id, parent) AS (
  SELECT id, in_reply_to_id FROM pr_comments WHERE id = ?1
  UNION ALL
  SELECT p.id, p.in_reply_to_id FROM pr_comments p JOIN up ON p.id = up.parent
)
SELECT id FROM up WHERE parent IS NULL
```

### 6. Exclude the signed-in author in SQL, from the cached username

`author` in `pr_comments` is the exact GitHub login (`src-tauri/src/github_poller/persistence.rs:85`), and the signed-in login is already cached in the `config` table under `github_username` (`src-tauri/src/github_runtime/auth.rs:16`). The three count queries can therefore exclude the user without any new plumbing or async work:

```sql
AND in_reply_to_id IS NULL
AND author <> COALESCE(
  (SELECT value FROM config WHERE key = 'github_username'), '')
```

The empty-string fallback is what makes the unknown-identity scenario in the spec fall out: before the username is cached, nothing matches the exclusion and every thread root counts, which is today's behaviour.

The renderer applies the same two clauses in `src/lib/useCommentSelection.svelte.ts:39`, which derives the comment list's unaddressed set in JavaScript. Without that, the badges would exclude the user's own replies while the list still showed them with a Mark addressed button.

### 7. Core renderer command, not the plugin host

`create_review_comment_reply` is reachable today only through the plugin host, gated on the GitHub Sync plugin id (`src-tauri/src/plugin_host/command_callbacks.rs:216`). Core gets its own wrapper in the existing `github-review` domain instead, beside `submitPrReview`.

Core already owns the poller, the table, the `getPrComments` read, and two other GitHub calls in that domain, so this adds no new ownership. Routing core UI through a plugin would invert the dependency, and KVG-2162, which removes that plugin-id gate, is not a prerequisite for either path.

### 8. No fallback for comments with no diff location

General pull request comments and review summaries are cached with no path and no line (`src-tauri/src/github_client/pulls.rs:202` and `:219`), and the inline adapter drops any comment without both (`packages/pr-review-ui/src/diffComments.ts:204`). With replies offered inline only, they have no surface, so every comment that gets a reply box is an inline review comment and the replies endpoint always accepts it. One write path, one error path.

Posting a plain pull request comment instead was considered and dropped. GitHub does not thread those, so such a reply arrives as a new thread root that the addressed rule cannot connect to anything, which means a second addressed model. There is also no write path for them anywhere in the repo today, only the read at `src-tauri/src/github_client/pulls.rs:149`.

## Risks / Trade-offs

**Badges and attention numbers drop the moment this ships, with no user action.** → Intended, and worth saying out loud in the release note: the old numbers counted the user's own comments. Nothing is lost, because `addressed` rows are untouched and the old counts can be recovered by reverting the query change alone.

**A required field on the public `PrComment` SDK type breaks plugin code that builds one.** → Readers are unaffected. Authors who construct fixtures need one line. The alternative, an optional field, would let a caller silently omit the parent and produce a comment that looks like a thread root.

**Threads stay flat for up to one poll interval after the update.** → Only affects comments cached before the update. Replies the user posts are inserted immediately, so the visible gap is limited to reviewer threads that existed beforehand.

**The recursive CTE could loop on cyclic data.** → GitHub cannot produce a cycle, and SQLite's recursive CTE terminates on the join rather than on depth. A depth cap is available if a malformed row ever appears.

**Marking the root addressed hides a thread the user answered but did not resolve.** → The reviewer's next reply brings it straight back, which is the whole point of the rule. A user who wants it visible regardless can use the comment list's show-addressed toggle.

## Migration Plan

1. Additive column on `pr_comments`, following the `outdated` precedent at `src-tauri/src/db/migrations.rs:1510`: guard on `pragma_table_info`, then `ALTER TABLE ... ADD COLUMN in_reply_to_id INTEGER`. Nullable, no default needed. The base schema at `:117` gains the column for fresh installs.
2. Ship the poller update in the same release, so the first poll after upgrade fills the column.
3. Ship the count queries and the renderer filter together. Splitting them would show a list and a badge that disagree.

Rollback is the migration's own inverse only in the sense that the column can be left in place: an older build ignores an unknown column, and reverting the query change restores the old counts. No data is destroyed at any point, since nothing is deleted or rewritten except a column that was previously absent.

## Open Questions

- How often is a review summary or a general pull request comment the thing the user actually wants to answer? If it turns out to be common, decision 8 gets revisited and a composer for those comments becomes a separate change. Nothing in this design blocks that: the column, the migration, and the SDK field all land here regardless, and the addition would be a new write command plus a surface to put it on.
