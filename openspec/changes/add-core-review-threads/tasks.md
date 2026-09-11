## 1. Core store

- [ ] 1.1 Add the `review_threads` and `review_thread_messages` migration, with the lookup index on `(namespace, target_key, revision)` and the partial unique index on that triple plus `idempotency_key`; verify the migration test asserting expected tables in `db/migrations.rs` includes both new tables and that `cargo test migrations` passes
- [ ] 1.2 Add the thread store module with list, create, reply, set status, and mark seen, returning `Result<T, String>` at the boundary; verify unit tests cover ordered message read-back and per-revision scoping
- [ ] 1.3 Enforce the write-time invariants (non-empty file path, line at least 1, side `LEFT` or `RIGHT`, non-empty body) with a message naming the offending field; verify a unit test per invariant asserts the rejection text and that nothing is stored
- [ ] 1.4 Implement idempotent create: a repeated key on the same triple returns the stored thread as a success, and the same key on another revision creates a new thread; verify both paths with store tests

## 2. Host boundary

- [ ] 2.1 Add the app-invoke commands for the thread operations with camelCase payload keys; verify request-level tests cover a rejected anchor and a successful create
- [ ] 2.2 Emit a coalescible thread-change event scoped to `(namespace, targetKey, revision)` on every write; verify a test asserts one event per write and that an unrelated scope receives none
- [ ] 2.3 Wire the commands into the plugin host callbacks **outside** the `plugin_may_invoke_private_host_commands` gate; verify a test asserts a non-GitHub-Sync plugin id is authorized for every thread operation

## 3. Public SDK surface

- [ ] 3.1 Add the unified `ReviewThread`, anchor, scope, and request types to the SDK domain types; verify `pnpm exec tsc --noEmit` passes
- [ ] 3.2 Add `reviewThreads` to `OpenForgeCommonAPI` with list, create, reply, setStatus, markSeen, and onDidChange; verify the SDK contract test asserts the operation set on both the frontend and backend surfaces
- [ ] 3.3 Add testing fakes for `reviewThreads` alongside the existing SDK fakes; verify a fake-backed test creates and lists a thread without a host
- [ ] 3.4 Mark `AgentReviewComment`, `AiThread`, and `AiThreadAnchor` removed from the SDK domain; verify no first-party workspace still imports them

## 4. Agent CLI and transport

- [ ] 4.1 Add the `review thread list|create|reply|status` command group to the CLI with its usage entries and help text; verify the CLI command tests cover flag validation and a missing required flag
- [ ] 4.2 Add the matching `POST /review_threads/*` routes to the agent transport allowlist; verify the `agent_routes` unit tests assert each new route is allowed and that an unlisted review route is refused
- [ ] 4.3 Add a `ToolPolicy` variant that appends `Bash(openforge review:*)` to the read-only tool whitelist while keeping `Write` and `Edit` disallowed; verify a unit test asserts the composed allow and disallow strings
- [ ] 4.4 Point the repo-aware review generation at the new tool policy; verify a test asserts the spawned generation carries the widened allowlist

## 5. Diff viewer contract

- [ ] 5.1 Replace `AgentCommentDisplayData` and `AiThreadCommentDisplayData` with one `ThreadCommentDisplayData` in `diffComments.ts`; verify the existing `diffComments` tests pass against the single variant
- [ ] 5.2 Collapse `InlineAiReviewComment.svelte` and `InlineAiQuestionThread.svelte` into one inline thread component that renders agent-authored and person-authored messages through one presentation; verify the inline thread tests cover both author roles on one line
- [ ] 5.3 Swap the `DiffViewer` props: add `threads`, `onCreateThread`, `onReplyToThread`, `onSetThreadStatus`, and remove the six agent-comment and AI-thread props; verify `pnpm test packages/pr-review-ui` passes
- [ ] 5.4 Report a thread whose anchor does not resolve to a rendered line as orphaned rather than hiding it; verify a viewer test asserts an out-of-diff thread is still readable and resolvable

## 6. Core self-review migration and legacy removal

- [ ] 6.1 Feed core's self-review `DiffViewer` from `reviewThreads` and drop its legacy status-update call; verify the self-review diff viewer tests pass
- [ ] 6.2 Delete the `getAgentReviewComments` and `updateAgentReviewCommentStatus` host commands, their plugin host entries, and their renderer IPC wrappers and registry entries; verify the generated desktop IPC registry check and `pnpm test src/lib/ipc.test.ts` pass
- [ ] 6.3 Delete `review_parser.rs`, `db/agent_review.rs`, their `main.rs` module declarations, and drop the `agent_review_comments` table in a migration; verify `cargo test` and `cargo clippy` pass with no dead-code warnings

## 7. GitHub Sync adapter

- [ ] 7.1 Add a plugin-local adapter mapping its stored `AgentReviewComment` and `AiThread` records onto the new `threads` prop, keeping its existing storage and parse-based writes; verify `pnpm test plugins/github-sync` passes with no behavior change to its review view
- [ ] 7.2 Remove the plugin's now-unused `getAgentReviewComments` and `updateAgentReviewCommentStatus` backend methods and client entries; verify the plugin's backend and client tests pass

## 8. Full affected-system verification

- [ ] 8.1 Run the Rust sidecar suite from the backend crate root (`cargo test`, `cargo clippy`) and report results, since this change adds a migration and a transport boundary
- [ ] 8.2 Run `pnpm test` and `pnpm exec tsc --noEmit` across the workspace and report results, since the SDK contract and the shared viewer prop surface cross package boundaries
- [ ] 8.3 Run `openspec validate add-core-review-threads --strict` and confirm the delta spec passes
