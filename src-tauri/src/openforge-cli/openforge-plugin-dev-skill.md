---
name: openforge-plugin-dev
description: Create, update, or review OpenForge plugin packages using the installed plugin SDK and runtime contract.
---

# OpenForge plugin authoring

Use this skill when creating, updating, or reviewing an OpenForge plugin package. The canonical human-facing guide is `docs/plugin-authoring.md`; check `packages/plugin-sdk/src/types.ts` for exact TypeScript interfaces and `docs/adr/0002-openforge-plugin-package-runtime.md` for deeper runtime rationale.

Default to building a normal OpenForge plugin package. Only focus on scheduler-style task APIs when the plugin's product goal is to create/start OpenForge tasks on behalf of a user or background service.

## Contract summary

- Plugins are trusted OpenForge packages declared in `package.json#openforge` with `id`, `apiVersion`, display metadata, optional `frontend` / `backend` built entry points, and `requires` capabilities.
- Frontend plugins can register views, task-pane tabs, settings sections, commands, and events after importing `defineFrontendPlugin` from `@openforge-app/plugin-sdk/frontend`. They can use common host capabilities such as storage, tasks, projects, fs, shell, notifications, attention, system, config, projectConfig, navigation, and same-plugin backend RPC.
- Backend plugins can register backend methods, background services, commands, and events after importing `defineBackendPlugin` from `@openforge-app/plugin-sdk/backend`. They run in the trusted Node plugin-host sidecar. They do not render Svelte UI or use frontend-only registries such as views, taskPane, settings, navigation, or backend.whenReady.
- Use `context.subscriptions.add(...)` for every registration/cleanup. Do not import OpenForge renderer stores, raw Electron/preload APIs, Rust internals, or app IPC wrappers from plugin code.
- Plugin storage is JSON-only and automatically namespaced by plugin id. Prefer `storage.task`, `storage.project`, or `storage.global` based on the narrowest lifetime.

## Plugin creation workflow

1. Read `docs/plugin-authoring.md` and inspect nearby built-in plugins for the package/build/test pattern.
2. Define `package.json#openforge` with a unique plugin id, `apiVersion`, display metadata, optional `frontend` / `backend` built entry points, and `requires` capabilities.
3. Choose runtime responsibilities:
   - Use a frontend entry for Svelte views, task-pane tabs, settings sections, renderer commands/events, navigation, and same-plugin backend RPC.
   - Use a backend entry for Node dependencies, backend methods, background services, backend commands/events, or long-running integration work.
4. Implement only through public SDK imports. Register contributions with `context.subscriptions.add(...)` so deactivation cleans up correctly.
5. Add focused tests with `@openforge-app/plugin-sdk/testing` for package metadata, runtime registrations, command/backend method behavior, storage scoping, and cleanup.
6. Build the plugin artifacts referenced by `package.json#openforge`; OpenForge installs built entry points and does not compile plugin source on install.

## Scheduler-style task APIs, when relevant

Plugins that schedule OpenForge work should use the SDK task capability, not the OpenForge CLI or raw host calls:

```ts
const task = await openforge.tasks.create({
  initialPrompt: 'Refresh the billing export job',
  projectId,
  dependsOn: ['T-123'],
  labelNames: ['scheduled']
})

const run = await openforge.tasks.startImplementation({ taskId: task.id })
```

`tasks.create` creates backlog tasks only. `tasks.startImplementation` starts the native OpenForge implementation flow using the task/project configuration; plugins cannot choose provider, model, permission mode, branch, workspace path, or initial status through these calls. Handle failures for unmet dependencies, active sessions, missing projects/checkouts, or unavailable provider/PTY runtime.

## Before editing

1. Read `docs/plugin-authoring.md`.
2. Verify the plugin uses public SDK imports only.
3. Add or update focused tests with `@openforge-app/plugin-sdk/testing` when behavior changes.
