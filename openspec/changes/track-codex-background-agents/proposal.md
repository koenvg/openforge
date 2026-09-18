## Why

A Codex parent turn can stop while one or more child agents continue working. OpenForge does not track Codex child-agent lifecycle events, so a Task can remain `running` after the final child has stopped, and a late tool hook can reopen a turn that already ended.

## What Changes

- Track Codex child-agent starts and confirmed completions as background work owned by the parent turn.
- Keep the Agent Session `running` while the parent turn or any child agent remains active.
- Mark the Agent Session `completed` only after the parent turn has ended and every child agent for that turn has stopped.
- Fence delayed tool hooks and child events by Codex turn and PTY identity so stale activity cannot reopen or complete the current turn.
- Preserve ordinary Codex completion when a turn has no child agents, including transcript-detected capacity and interruption endings.
- Retain lifecycle completion for replay when OpenForge is temporarily unavailable.
- Cover concurrent child agents, out-of-order hook delivery, new follow-up turns, and missing or malformed child metadata.

## Capabilities

### New Capabilities

- `codex-background-work`: Defines how OpenForge derives a Codex Agent Session's running and completed states from the parent turn and its child agents.

### Modified Capabilities

None.

## Impact

- Codex lifecycle hook profile and installed hook script.
- Hook-side turn and child-agent coordination state.
- Agent lifecycle notifications and Codex lifecycle tests.
- No renderer, plugin SDK, database schema, or public IPC contract changes are expected.
