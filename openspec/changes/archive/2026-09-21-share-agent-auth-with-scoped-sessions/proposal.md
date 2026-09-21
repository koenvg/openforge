## Why

Scoped Claude sessions replace Claude's normal configuration directory with an empty per-session directory. That also replaces the credential context, so a user who is already signed in for normal Task agents sees Claude's first-run flow and cannot start the scoped review agent.

## What Changes

- Launch a Scoped Agent Session with the same effective provider authentication as a normal Task agent for the selected Project.
- Keep the scoped session's host policy separate from provider authentication. Personal permissions, hooks, plugins, slash commands, MCP servers, and other user configuration remain excluded.
- Preserve the existing read-only workspace guarantee while allowing Claude to write only the provider-owned state required for the scoped conversation and later continuation.
- Detect unavailable provider authentication before launching the agent and return an actionable session error instead of showing an unusable login or onboarding flow.
- Remove the obsolete Claude permission rule that currently prints an unknown-tool warning at session startup.

This change follows `add-scoped-agent-sessions`. That change introduces the `scoped-agent-sessions` capability and must land and sync before this delta is archived.

## Capabilities

### New Capabilities

- `agent-provider-authentication`: Define how normal and scoped Agent Sessions use the user's configured provider identity while keeping scoped policy and session state separate.

### Modified Capabilities

None.

## Impact

- Scoped Claude runtime environment and provider launch preparation.
- Claude authentication readiness checks and scoped lifecycle errors.
- macOS sandbox paths for provider-owned conversation state.
- Scoped session release and startup cleanup for OpenForge-owned policy and lifecycle state.
- Provider adapter, command construction, policy settings, and integration tests.
