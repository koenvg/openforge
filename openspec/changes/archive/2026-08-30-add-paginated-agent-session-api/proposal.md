## Why

The public Plugin SDK can list Agent Sessions only after a plugin names one Task, so plugins that need bounded cross-Task session history must first enumerate full Task rows or rely on a use-case-specific host query. A first-class paginated Agent Session query provides the reusable identity and attribution context needed by import, diagnostics, migration, and audit tooling without exposing Task prompts or introducing host-level usage storage.

## What Changes

- Add a first-class `agentSessions.list()` Plugin SDK API for bounded, cursor-paginated Agent Session discovery across Tasks.
- Support provider, optional Task, and closed-open activity interval filters so a caller can resume against an immutable time boundary.
- Return compact Agent Session summaries with an unambiguous provider session ID plus compact Task and workspace context.
- Keep the existing task-scoped `tasks.listSessions()` API compatible as a convenience for callers that already know the Task.
- Replace the unshipped usage-specific Task candidate contract with the generic Agent Session query before releasing the next Plugin SDK package.
- Expose the API through frontend and backend host bridges, generated runtime assets, CommonAPIFake, public documentation, and the packaged Plugin SDK.
- Do not add host-level Codex usage storage or workspace-only transcript scanning for Tasks that lack an attributable Agent Session.

## Capabilities

### New Capabilities

- `plugin-agent-sessions`: Bounded public discovery of provider Agent Sessions with compact Task and workspace attribution context.

### Modified Capabilities

None.

## Impact

The change affects `@openforge-app/plugin-sdk`, its testing fakes and published types, Electron and Rust host callbacks, SQLite session queries and indexes, generated plugin-host runtime assets, IPC contracts, package documentation, and contract/host/database tests. Plugins such as `com.openforge.codex-usage` can use the released SDK for explicit historical import without unscoped `tasks.list()` calls.