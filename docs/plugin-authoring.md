# OpenForge plugin authoring

OpenForge plugins are trusted app extensions packaged as normal npm-style packages. They use the public `@openforge-app/plugin-sdk` contract and register contributions at runtime; they should not import OpenForge app internals.

For exact types, see `packages/plugin-sdk/src/types.ts`. For the architectural rationale and longer examples, see `docs/adr/0002-openforge-plugin-package-runtime.md`.

## Package metadata

Each plugin declares OpenForge metadata in `package.json#openforge` and ships already-built JavaScript entry points:

```json
{
  "name": "@acme/openforge-notes",
  "version": "1.0.0",
  "dependencies": {
    "@openforge-app/plugin-sdk": "^0.1.0"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "openforge": {
    "id": "acme.notes",
    "apiVersion": 1,
    "displayName": "Notes",
    "description": "Project notes and scheduled follow-ups",
    "icon": "notebook-text",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.js",
    "requires": ["views", "tasks", "storage", "notifications", "backend"]
  }
}
```

Rules:

- `openforge.id` must be unique app-wide. Runtime contribution IDs are local and auto-qualified with this plugin id.
- `openforge.apiVersion` is the compatibility gate. Current plugin SDK types expose API version `1`.
- `frontend` and `backend` are optional, independent built artifacts. A frontend-only plugin can still use host task, project, storage, filesystem, shell, notification, and config capabilities when enabled by the host runtime.
- `requires` should list the host capabilities the package expects so OpenForge can validate and explain missing support.
- Installed packages should contain built artifacts; OpenForge does not compile source on install.

## Frontend entry point

Frontend plugins run in the renderer and register UI contributions plus renderer-available host capabilities:

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'notes',
      title: 'Notes',
      icon: 'notebook-text',
      placement: 'rail',
      component: () => import('./NotesView.svelte')
    }))
  }
})
```

Frontend-only registries and helpers:

- `openforge.views.register(...)`
- `openforge.taskPane.registerTab(...)`
- `openforge.settings.registerSection(...)`
- `openforge.navigation.get()` / `navigate(...)`
- `openforge.backend.whenReady()` / `invoke(...)` for the same plugin's backend methods

Svelte plugin components receive `api` and `context` props. Use Svelte 5 runes in components and avoid importing app stores directly.

## Backend entry point

Backend plugins run in the trusted shared Node plugin-host sidecar. They are appropriate for Node dependencies, background services, and plugin-local RPC methods:

```ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } }
      },
      output: {
        type: 'object',
        required: ['synced'],
        properties: { synced: { type: 'number' } }
      },
      handler: async ({ projectId }: { projectId: string }) => {
        await openforge.storage.project(projectId).set('lastSyncStartedAt', Date.now())
        return { synced: 1 }
      }
    }))
  }
})
```

Backend-only registries:

- `openforge.backend.registerMethod(...)`
- `openforge.background.register(...)`

Backend plugins can also register commands/events and use common host capabilities through the backend host callback bridge. They cannot register Svelte views, task-pane tabs, settings sections, or use frontend-only navigation/backend-readiness helpers.

## Capability availability

| Capability group | Frontend runtime | Backend runtime |
| --- | --- | --- |
| `commands`, `events`, `storage`, `context` | Supported | Supported |
| `tasks`, `projects`, `fs`, `shell`, `notifications`, `attention`, `system.openUrl`, `config`, `projectConfig` | Supported through the renderer host bridge when wired for the active runtime | Supported through backend host callbacks |
| `views`, `taskPane`, `settings`, `navigation` | Supported in the renderer | Not exposed |
| `backend.whenReady`, `backend.invoke` | Supported for same-plugin backend RPC | Not applicable |
| `backend.registerMethod`, `background.register` | Not exposed | Supported |

Unavailable capabilities fail with named capability errors. Do not treat unsupported runtime calls as no-ops.

## Storage

Plugin storage is JSON-only and automatically namespaced by plugin id. Use the narrowest scope that matches the lifetime of the data:

```ts
await openforge.storage.global.set('preferences', { compact: true })
await openforge.storage.project(projectId).set('repo', { owner: 'acme', name: 'app' })
await openforge.storage.task(taskId).set('reviewState', { viewedFiles: ['README.md'] })
```

Use task storage for task-pane state, project storage for integration state tied to one project, and global storage for plugin-wide preferences.

## Scheduler-style task APIs

Plugins can create OpenForge tasks and start native implementation runs through the versioned `tasks` capability. This is the supported path for scheduler-style plugins; do not shell out to the OpenForge CLI or call Electron/preload APIs directly from plugin code.

```ts
const task = await openforge.tasks.create({
  initialPrompt: 'Refresh the billing export job',
  projectId,
  dependsOn: ['T-123'],
  labelNames: ['scheduled']
})

const run = await openforge.tasks.startImplementation({
  taskId: task.id
})

await openforge.tasks.configureStartPromptContribution({
  projectId,
  id: 'handoff-notes-workflow',
  enabled: true,
  content: '<openforge_task_management>Task {{taskId}}\n## Current summary\nWhat changed and whether the task is ready for review.</openforge_task_management>',
  order: 0
})
```

Behavior and limits:

- `projectId` is required for plugin-created tasks.
- `tasks.create` creates backlog tasks. Plugins may attach dependency task IDs and label names; missing labels are created by the host.
- `tasks.startImplementation` starts OpenForge's native implementation flow and returns `{ taskId, sessionId, workspacePath }` once launch is accepted.
- `tasks.configureStartPromptContribution({ projectId, id, enabled, content, order })` is the generic plugin-owned start-prompt contribution switch. The host stores bounded prompt text per project and injects enabled contributions before OpenForge's task prompt. The host substitutes `{{taskId}}`/`{{task_id}}`; plugins still own their contribution wording.
- Projects that never configure contributions do not receive plugin-owned prompt text in new implementation prompts. Existing tasks that already had `handoff_notes_enabled` are migrated to an equivalent generic `handoff-notes-workflow` contribution so they keep their prior behavior.
- The host resolves provider, agent, permission mode, model, branch/worktree strategy, and project checkout from OpenForge state. Plugins cannot override those execution settings in the API call or through start-prompt contribution configuration.
- Starting an implementation can fail when dependencies are unmet, an active agent session already exists, the task/project cannot be resolved, the checkout/workspace cannot be prepared, or the configured provider/PTY runtime is unavailable.
- `tasks.getWorkspace(taskId)` and `tasks.getLatestSession(taskId)` return `null` until OpenForge has recorded that state.

## Testing plugins

Use `@openforge-app/plugin-sdk/testing` for plugin tests. The registry fake is best when asserting registrations, namespacing, command invocation, backend RPC, background service lifecycle, or cleanup:

```ts
import { describe, expect, it } from 'vitest'
import plugin from '../src/frontend'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'

describe('frontend activation', () => {
  it('registers the Notes view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'acme.notes', projectId: 'P-1' })

    await registry.activateFrontend(plugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'notes', qualifiedId: 'acme.notes.notes', title: 'Notes' }
    ])
  })
})
```

For unit tests that only need an API object, use `createMockOpenForgeApi`, `createMockFrontendOpenForgeApi`, or `createMockBackendOpenForgeApi`; host-facing calls are recorded under `api.__testing.calls`.

## Authoring checklist

- Use only `@openforge-app/plugin-sdk`, `@openforge-app/plugin-sdk/frontend`, `@openforge-app/plugin-sdk/backend`, or documented npm dependencies from plugin code.
- Register every contribution through `context.subscriptions.add(...)` so deactivation cleans up correctly.
- Keep frontend and backend responsibilities separate.
- Validate command/backend method inputs when data crosses runtime boundaries.
- Prefer SDK task APIs for scheduler work.
- Add focused tests for registrations, storage scoping, task creation/start behavior, and lifecycle cleanup.
