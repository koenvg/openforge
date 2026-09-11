## Context

See proposal.md for motivation. The state that shapes the approach:

- `plugins/github-sync/src/lib/reviewCommentsParse.ts` parses the agent's final text and returns `[]` on any failure. `plugins/github-sync/src/lib/walkthroughStore.ts` calls it once per run, so one bad character loses the review.
- The agent runs through `agent_generate_in_repo` (`src-tauri/src/app_invoke/agent_generate.rs`) under `ToolPolicy::ReadAndGitHistory`, which allows `Read Grep Glob` plus read-only git. It cannot run the CLI.
- The CLI already reaches plugin code: `openforge plugin command invoke` is allowlisted for agents in `src-tauri/crates/session-protocol/src/agent_routes.rs`. Transport is not the missing piece; a durable store and a public API are.
- Agent transport auth requires a real task row plus four ownership headers (`src-tauri/src/http_server/agent_ingress.rs`). A headless generation has a session key, not a task.
- Core already carries an abandoned first attempt: the `agent_review_comments` table (`db/migrations.rs:325`), `db/agent_review.rs`, and `review_parser.rs`. Nothing has written that table since generation moved into the plugin, so its reads return empty. `review_parser.rs` is referenced only by `main.rs:54` and its own tests.
- Every review host command is gated by `plugin_may_invoke_private_host_commands`, which is `matches!(plugin_id, GITHUB_SYNC_PLUGIN_ID)`.
- `packages/pr-review-ui` imports from the SDK for UI components and pure helpers only. It never touches a live host API, and core embeds the same `DiffViewer` for task self-review.

## Goals / Non-Goals

**Goals:**

- A write path with a rejection reason, so a failed comment is diagnosable instead of missing.
- A store core owns but does not understand, so a review surface outside core can use it.
- One thread model, so the viewer has one inline presentation instead of two.

**Non-Goals:**

- Deciding how an agent obtains a review-scoped identity. This change reuses the existing task-scoped agent identity; the next change adds owner-derived scoping.
- Any knowledge of pull requests, GitHub, or Jira inside core threads.
- Run orchestration, progress reporting, or cancellation.

## Decisions

### 1. Opaque target identity, not a core-modeled review target

Threads are keyed by `(namespace, target_key, revision)`, all strings. Core stores and compares them and nothing else. A plugin picks `("github", "gh:acme/web#1421", "<sha>")`; task self-review picks `("task", "<task-id>", "<sha>")`.

Alternative considered: a core `review_targets` table with a foreign key, as `agent_review_comments.review_pr_id` does today. Rejected because it puts the pull-request domain back in core, which is the opposite of the direction this work serves, and because it forces a second target kind before task self-review can reuse the store.

Cost accepted: no referential integrity. A thread can outlive whatever its target key named. That is why anchors are resolved at render time and orphans are shown rather than hidden.

### 2. One thread, two status axes, two anchor kinds

```
ReviewThread
  id, namespace, targetKey, revision
  runId: string | null            (opaque, decision 8)
  origin: 'agent' | 'human' | 'plugin'
  anchor:
    | { kind: 'line', filePath, line, side: 'LEFT' | 'RIGHT' }
    | { kind: 'custom', key }
  status: 'open' | 'resolved' | 'dismissed'
  awaiting: 'none' | 'agent' | 'error'
  idempotencyKey: string | null
  seenAt: number | null
  messages: { role: 'agent' | 'human', body, createdAt }[]
```

This replaces `AgentReviewComment` (flat, `status: pending | approved | dismissed`) and `AiThread` (threaded, `status: draft | pending | answered | error`). Those two enums mix a reviewer decision with an in-flight agent turn, so they become `status` and `awaiting`.

`AiThreadAnchor` has a third variant, `comment`, used when a reviewer asks a follow-up about an agent comment. It disappears: the follow-up is a message on the agent's own thread. One anchor kind and one join fewer.

The walkthrough `step` anchor becomes `{ kind: 'custom', key }`. Core does not interpret the key.

### 3. Two tables, and delete the old one in the same change

`review_threads` plus `review_thread_messages`, with a unique index on `(namespace, target_key, revision, idempotency_key)` where the key is not null, and a lookup index on `(namespace, target_key, revision)`.

`agent_review_comments`, `db/agent_review.rs`, and `review_parser.rs` are dropped in this change rather than deprecated. The table has no writer, so nothing is lost. Its two live host commands and their renderer wrappers go with it, which touches core's self-review `DiffViewer` call site.

Alternative considered: generalize `agent_review_comments` in place by widening `review_pr_id`. Rejected because the messages table is new anyway, the column names encode the pull-request model, and a migration that rewrites live-but-empty rows is more work than a drop.

### 4. Public SDK API, not a private host command

`reviewThreads` lands on `OpenForgeCommonAPI`, so both the frontend and backend surfaces get it, and it is deliberately outside `plugin_may_invoke_private_host_commands`.

```ts
interface ReviewThreadsAPI {
  list(scope: ReviewThreadScope): Promise<ReviewThread[]>
  create(request: CreateReviewThreadRequest): Promise<ReviewThread>
  reply(request: ReplyToReviewThreadRequest): Promise<ReviewThread>
  setStatus(request: SetReviewThreadStatusRequest): Promise<ReviewThread>
  markSeen(request: { threadId: string }): Promise<void>
  onDidChange(scope: ReviewThreadScope, handler: (event: ReviewThreadChangeEvent) => void): Disposable
}
```

`onDidChange` follows the `tasks.onDidChange` precedent: the event is a coalescible invalidation for a scope, never a snapshot. Subscribers repeat `list`.

The remaining private commands an external review plugin needs (`getPrFileDiffs`, `submitPrReview`, the Jira calls) stay gated. That fight is KVG-2162.

### 5. CLI verbs mirror the SDK, and the agent gets a narrow tool policy

```
openforge review thread list   --namespace <ns> --target <key> --revision <rev>
openforge review thread create --namespace <ns> --target <key> --revision <rev> \
                               --file <path> --line <n> --side RIGHT --body <text> [--key <idem>] [--run <id>]
openforge review thread reply  --thread-id <id> --body <text>
openforge review thread status --thread-id <id> --status open|resolved|dismissed
```

New allowlist entries in `agent_routes.rs` for the matching `POST /review_threads/*` routes. A new `ToolPolicy` variant adds `Bash(openforge review:*)` to the read-only whitelist, so the reviewer gains exactly the CLI it needs and keeps `Write` and `Edit` on the disallowed list.

**Interim limitation, stated plainly:** this change authorizes a thread write by the existing task-scoped agent identity and takes the target from the request. An agent with a valid identity can therefore write to any target key. The next change derives the target from the session owner and closes this. Accepted for now because the only caller is a locally spawned review agent.

### 6. Idempotency scoped to the target triple

The unique index covers `(namespace, target_key, revision, idempotency_key)`. A repeated key returns the stored thread with a success result, not a conflict error, so a retrying agent needs no special case. Reusing a key under a new revision creates a new thread, which is the behavior a re-review after a force-push wants.

Alternative considered: hashing the anchor plus body as an implicit key. Rejected because an agent legitimately posts two different comments on one line, and because it makes a corrected retry look like a new comment.

### 7. Structural invariants at write time, anchor resolution at render time

Core validates non-empty file path, line at least one, side in `LEFT`/`RIGHT`, non-empty body, and a revision matching the request scope. It returns a message naming the offending field.

Core cannot check that a line is commentable: that needs the patch, which lives with whichever surface fetched the diff (`hunkParser.ts` today). So an anchor outside the diff is stored and reported as orphaned when rendered.

Alternative considered: a plugin-registered validator invoked on write, giving the agent a true "that line is not in the diff" rejection. Rejected for now because it couples the CLI write path to a live plugin host, so a plugin reload during a review would fail writes. Worth revisiting once the write path has a track record.

### 8. The plugin owns the run, core stores an opaque run id

Core has no run table, no run status, and no notion of a run finishing. A caller that wants "still reviewing" holds that itself.

Trade-off accepted: nothing reconciles a run that dies mid-review, so its threads keep an orphaned run id. Tolerable while the same plugin owns both the run and the session that hosts it. If that stops being true, a core run record becomes the fix.

### 9. The diff viewer keeps taking props

`DiffViewer` gains `threads`, `onCreateThread`, `onReplyToThread`, `onSetThreadStatus`, and loses `agentComments`, `onAgentCommentsChange`, `onUpdateAgentCommentStatus`, `aiThreads`, `onAskAgent`, `onAskAboutComment`. Seven props become four.

The deciding constraint is that core embeds this viewer for task self-review. If the viewer read threads from the SDK, core's own review path would call the plugin SDK to reach core's own database. Props also keep the existing viewer tests free of a mocked host.

`diffComments.ts` loses `AgentCommentDisplayData` and `AiThreadCommentDisplayData` for one `ThreadCommentDisplayData`, and `InlineAiReviewComment.svelte` plus `InlineAiQuestionThread.svelte` collapse into one component. GitHub's own comments stay on the separate `existingComments` prop: they live on GitHub, and core threads are local.

## Risks / Trade-offs

- **An agent posts to a target it does not own** (decision 5) → Only locally spawned review agents can reach the routes today; the next change derives the target from the session owner.
- **Partial reviews become visible** because writes are incremental → Intended. The alternative is the current all-or-nothing loss. A caller that wants atomicity holds threads back behind its own run state.
- **Orphaned anchors confuse reviewers** → Orphans are shown and labelled, never hidden, so a comment is never silently dropped again.
- **Widening the tool policy** with `Bash(openforge review:*)` grants a read-only reviewer a write channel → The channel writes only threads, `Write` and `Edit` stay disallowed, and the routes stay on the agent allowlist.
- **No referential integrity on the target key** (decision 1) → Render-time orphan reporting, plus revision scoping so stale threads do not leak into a new revision.
- **Deleting the legacy table is irreversible** → It has no writer, so there is nothing to preserve; the migration is a drop, and a rollback recreates an empty table.
- **Six removed viewer props are used by two surfaces** → Both surfaces are in this repository and change in the same commit; the plugin keeps its own storage behind an adapter (see below) so its behavior does not move in this change.

## Migration Plan

1. Add the tables, the store, the host commands, the public SDK API, and the CLI verbs. Nothing reads them yet.
2. Change the `DiffViewer` prop surface and collapse the inline components.
3. Point core's self-review at the new API and delete the legacy host commands, their renderer wrappers, `db/agent_review.rs`, `review_parser.rs`, and the `agent_review_comments` table.
4. In GitHub Sync, add a local adapter that maps its existing `AgentReviewComment` and `AiThread` records from plugin storage onto the new `threads` prop. Its writes still come from the parse path. This keeps the plugin working, with no behavior change, and confines this change's plugin edits to presentation.
5. The third change replaces that adapter with real reads and CLI writes, then drops the `pr-ai-review:*` and `pr-ai-threads:*` keys.

Rollback: steps 1 and 2 are additive and safe to leave in place. Step 3 is the irreversible one; reverting it restores an empty legacy table and the adapter from step 4 keeps rendering from plugin storage regardless.

## Open Questions

- Retention. Threads accumulate one set per revision, and nothing prunes revisions a target has moved past. Deferrable: pruning is additive and changes no contract.
- Whether `custom` anchors need their own index. Depends on how the walkthrough uses them in the third change.
- Whether the CLI needs a batch create verb for a reviewer that posts many comments at once. Additive, and the per-comment rejection reason is the point of the design.
