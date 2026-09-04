## Why

OpenForge marks a Pi Agent Session completed when the parent turn ends, even if Pi Subagents still has detached work running. The Task then appears idle until the child completion wakes Pi, which hides active work and can mislead users for minutes.

## What Changes

- Keep a Pi Agent Session running while session-owned background subagent runs remain active.
- Use Pi's settled lifecycle boundary together with Pi Subagents' documented async lifecycle events instead of treating every low-level `agent_end` as completion.
- Restore outstanding background-subagent state after extension reload or session resume from the current Pi session's recorded lifecycle artifacts.
- Preserve normal completion when no background subagent work remains.

## Capabilities

### New Capabilities

- `pi-background-work`: Defines how OpenForge tracks Pi background subagents and derives the parent Agent Session's running or completed state.

### Modified Capabilities

None.

## Impact

- Pi lifecycle reporting in `src-tauri/src/pi-extension/openforge.ts`.
- Pi extension behavioral coverage in `src-tauri/src/pi_extension.rs`.
- Manual application verification with a real asynchronous Pi subagent run.
- No database migration, renderer change, public IPC change, or new runtime dependency is expected.
