## Why

Codex can run its standalone updater before the interactive client starts, which replaces the OpenForge Agent view with installer output and can leave the Task without an agent session when the update exits or fails. OpenForge needs Task startup to launch the installed Codex version predictably.

## What Changes

- Disable Codex startup update checks for sessions launched with OpenForge's generated Codex profile.
- Keep the override scoped to OpenForge so ordinary Codex launches retain the user's update behavior.
- Regenerate existing OpenForge Codex profiles with the override while preserving Codex hook trust state.
- Add regression coverage for fresh and regenerated profiles.
- Do not add an OpenForge-managed Codex updater or change global Codex configuration.

## Capabilities

### New Capabilities

- `codex-task-launch`: Defines how OpenForge starts Codex Task sessions without allowing provider update checks to replace the requested agent launch.

### Modified Capabilities

None.

## Impact

- Affects the Rust sidecar's generated `openforge-lifecycle` Codex profile and its unit tests.
- Changes only Codex processes launched through that profile. Other providers and direct Codex launches are unaffected.
- Adds no IPC, renderer, dependency, or storage changes.
