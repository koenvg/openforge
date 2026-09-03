## Why

When Claude backgrounds a subagent, OpenForge marks the task completed while the subagent is still working. The lead agent's `Stop` hook fires, nothing proves work is outstanding, and the board shows the task as finished until the subagent reports back minutes or hours later.

OpenForge decides "is work outstanding" by replaying the session transcript and looking for a `backgroundTaskId` (backgrounded shell) or a `taskId` (armed `Monitor`). An async `Agent` result carries neither. It reports `agentId`, `isAsync: true` and `status: "async_launched"`, so the parser skips it and every backgrounded subagent is invisible. The same blind spot applies to `Workflow` runs.

Claude 2.1.259 attaches a declared `background_tasks` inventory to the `Stop` hook payload whose stated purpose is to let hooks "distinguish 'session is done' from 'session is paused waiting for background work to wake it'". It covers shell, subagent, monitor and workflow tasks in one typed array. OpenForge already receives that payload and discards the field.

## What Changes

- Recognise async subagents when replaying the transcript, keyed on `agentId` with `isAsync: true`, so a backgrounded subagent holds the session open. Synchronous `Agent` results are already finished when observed and stay excluded.
- Read `background_tasks` from the `Stop` hook payload and prefer it over transcript replay. A present inventory is authoritative for what is still in flight.
- Fall back to transcript replay when the field is absent, so Claude builds that predate the inventory keep working.
- Treat unknown task types in the inventory as still running, so a future task type cannot silently retire a live session.
- No change to how background work ends. Subagents already announce completion through the same `<task-notification>` block the existing terminator parses.
- No breaking changes.

## Capabilities

### New Capabilities
- `claude-background-work`: when an agent session stays `running` past the lead agent's turn because Claude has outstanding background work, and what evidence OpenForge accepts as proof of that work.

### Modified Capabilities

None. No existing spec covers Claude hook lifecycle or session completion deferral.

## Impact

Affected code:
- `src-tauri/src/claude_background_work.rs`: subagent recognition in `pending_background_tasks`, plus a reader for the payload inventory.
- `src-tauri/src/http_server/legacy_transport/models.rs`: `ClaudeHookPayload` gains the `background_tasks` field.
- `src-tauri/src/http_server/legacy_transport/hook_routes.rs`: `deferrable_background_work` prefers the payload inventory and falls back to transcript replay.

Not affected: no database migration, no IPC or plugin contract change, no renderer change. The lifecycle state machine in `agent_lifecycle.rs` is untouched. The change only widens what counts as outstanding work feeding the existing `deferring.is_empty()` decision.

Known limits carried forward rather than fixed here:
- `DeferredCompletionWatcher` computes its grace deadline once per lead turn, so a silent subagent outliving the configured grace period still completes early. Recorded in design.
- A subagent resumed with `SendMessage` after it has already notified is not re-registered by transcript replay. The payload inventory covers this case when present.
