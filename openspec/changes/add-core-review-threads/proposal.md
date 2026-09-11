## Why

Agent review comments reach the app by parsing JSON out of the agent's final text response. When that parse fails, `parseAndValidateReviewComments` returns an empty array and the whole review is lost silently. The comment store also lives inside the built-in GitHub Sync plugin, and every review host command is gated on a hardcoded plugin id, so review conversations cannot be reused by other review surfaces and GitHub review cannot move out of core.

Replacing the parse with a written contract removes the silent-loss failure mode: an agent posts each thread through the OpenForge CLI and gets a rejection reason it can act on.

## What Changes

- Add a core-owned Review Thread store keyed by an opaque target identity: namespace, target key, and revision. Core never interprets the target key.
- Introduce one unified Review Thread model with ordered messages, replacing both `AgentReviewComment` (flat, agent-authored) and `AiThread` (threaded, reviewer-authored).
- Expose Review Threads as a public Plugin SDK API on the frontend and backend, available to every enabled plugin with no plugin-id allowlist.
- Add agent-facing CLI verbs so an agent creates, replies to, and resolves threads over allowlisted routes instead of returning JSON text.
- Make thread creation idempotent through a caller-supplied key, so a retrying agent does not duplicate comments.
- Validate anchors at write time against cheap invariants and reject with a reason. Anchor-to-diff resolution stays a render-time concern that marks a thread orphaned.
- Replace the diff viewer's two comment models with a single `threads` prop plus create, reply, and status handlers.
- **BREAKING** Remove the legacy agent review comment store: the `agent_review_comments` table, `review_parser.rs`, the `getAgentReviewComments` and `updateAgentReviewCommentStatus` private host commands, and their renderer IPC wrappers. The table has had no writer since review generation moved into the plugin, so every read already returns empty.

Out of scope, deliberately:

- Plugin-owned agent sessions and hidden tasks, so a review agent can run without a board task. Next change.
- Migrating GitHub Sync's writes off the parse path onto the CLI, and dropping its `pr-ai-review:*` and `pr-ai-threads:*` storage keys. Third change.
- Replacing the `GITHUB_SYNC_PLUGIN_ID` gate on the remaining private host commands. Tracked as KVG-2162.

## Capabilities

### New Capabilities
- `review-threads`: Core-owned, target-agnostic review conversations. Identity, unified thread model, public SDK surface, agent CLI writes, idempotency, anchor validation, change notification, and diff viewer rendering contract.

### Modified Capabilities

None.

## Impact

- New SQLite tables and migration for threads and thread messages. Removal of `agent_review_comments`.
- Public Plugin SDK: new `reviewThreads` API on the common surface, new domain types, retirement of `AgentReviewComment`, `AiThread`, and `AiThreadAnchor`.
- OpenForge CLI: new `review thread` command group, and new entries in the agent transport allowlist in `session-protocol`.
- `packages/pr-review-ui`: `DiffViewer` prop surface, `diffComments` display variants, and the two inline AI comment components collapse into one. The package keeps taking data through props and gains no host dependency.
- Core self-review call sites that still reference the legacy status update.
- GitHub Sync adopts the new viewer prop through a local adapter over its existing storage, so it keeps working unchanged until the third change moves its writes.
- Rust sidecar tests, SDK contract tests, CLI tests, and diff viewer tests.
