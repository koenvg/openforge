# OpenForge plugin examples and recipes

These recipes show the supported `@openforge-app/plugin-sdk` shapes for API version `1`. They stay inside the plugin boundary: import from documented SDK entry points, register contributions in `activate()`, add disposables to `context.subscriptions`, and use host capabilities instead of Electron, preload, app stores, OpenForge CLI calls, or SDK internals.

For the full contract, see the [plugin authoring guide](../plugin-authoring.md), [capabilities reference](./capabilities.md), and [`@openforge-app/plugin-sdk` reference](./sdk-reference.md).

## Minimal package metadata

Declare only the capabilities your plugin uses. OpenForge loads built entry points; it does not compile plugin source at install time.

```json
{
  "name": "@acme/openforge-planner",
  "version": "1.0.0",
  "dependencies": {
    "@openforge-app/plugin-sdk": "^0.1.0"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "openforge": {
    "id": "acme.planner",
    "apiVersion": 1,
    "displayName": "Planner",
    "description": "Project planning recipes for OpenForge",
    "icon": "calendar-check",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.cjs",
    "requires": [
      "views",
      "navigation",
      "backend",
      "commands",
      "background",
      "tasks",
      "storage",
      "context",
      "notifications",
      "system.openUrl",
      "config",
      "projectConfig"
    ]
  }
}
```

## Frontend-only view

Use a frontend plugin for renderer UI such as a rail view. Svelte components receive `api` and `context` props.

```ts
// src/frontend.ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'today',
      title: 'Today',
      icon: 'calendar-days',
      placement: 'rail',
      component: () => import('./TodayView.svelte'),
    }))
  },
})
```

```svelte
<!-- src/TodayView.svelte -->
<script lang="ts">
  import type { PluginViewProps } from '@openforge-app/plugin-sdk/frontend'

  interface Props extends PluginViewProps {}

  let { api, context }: Props = $props()
  let selectedTaskId = $state<string | null>(context.taskId ?? null)

  async function openSelectedTask() {
    if (!selectedTaskId) return
    await api.navigation.navigate({ viewId: 'board', taskId: selectedTaskId })
  }
</script>

<section>
  <h2>Today</h2>
  <p>Project: {context.projectId ?? 'none selected'}</p>
  <input bind:value={selectedTaskId} placeholder="Task id" />
  <button onclick={openSelectedTask} disabled={!selectedTaskId}>Open task</button>
</section>
```

## Backend method plus frontend view

Register backend RPC methods from the backend entry point, then call them from the same plugin's frontend with `openforge.backend.whenReady()` and `openforge.backend.invoke(...)`.

```ts
// src/backend.ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

type GetProjectStatsInput = { projectId: string }
type ProjectStats = { projectId: string; noteCount: number }

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod<GetProjectStatsInput, ProjectStats>('getProjectStats', {
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } },
      },
      output: {
        type: 'object',
        required: ['projectId', 'noteCount'],
        properties: {
          projectId: { type: 'string' },
          noteCount: { type: 'number' },
        },
      },
      async handler({ projectId }) {
        const notes = await openforge.storage.project(projectId).get<string[]>('notes')
        return { projectId, noteCount: notes?.length ?? 0 }
      },
    }))
  },
})
```

```ts
// src/frontend.ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'stats',
      title: 'Project stats',
      icon: 'chart-no-axes-column',
      placement: 'rail',
      component: () => import('./StatsView.svelte'),
    }))
  },
})
```

```svelte
<!-- src/StatsView.svelte -->
<script lang="ts">
  import type { PluginViewProps } from '@openforge-app/plugin-sdk/frontend'

  interface Props extends PluginViewProps {}
  type ProjectStats = { projectId: string; noteCount: number }

  let { api, context }: Props = $props()
  let loading = $state(false)
  let stats = $state<ProjectStats | null>(null)
  let error = $state<string | null>(null)

  async function loadStats() {
    if (!context.projectId) {
      error = 'Open a project first.'
      return
    }

    loading = true
    error = null

    try {
      await api.backend.whenReady()
      stats = await api.backend.invoke<ProjectStats>('getProjectStats', { projectId: context.projectId })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }
</script>

<button onclick={loadStats} disabled={loading}>Load stats</button>

{#if stats}
  <p>{stats.noteCount} notes for project {stats.projectId}</p>
{/if}

{#if error}
  <p role="alert">{error}</p>
{/if}
```

## Command plus background service

Commands and background services are backend-friendly when the work needs Node dependencies or should continue outside a visible view. Register both in the backend entry point.

```ts
// src/backend.ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

type SyncInput = { projectId: string }
type SyncOutput = { projectId: string; syncedAt: number }

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register<SyncInput, SyncOutput>({
      id: 'sync-now',
      title: 'Sync project data',
      icon: 'refresh-cw',
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } },
      },
      async handler({ projectId }) {
        const syncedAt = Date.now()
        await openforge.storage.project(projectId).set('lastSync', { syncedAt })
        return { projectId, syncedAt }
      },
    }))

    let interval: ReturnType<typeof setInterval> | null = null

    context.subscriptions.add(openforge.background.register({
      id: 'sync-poller',
      scope: 'project',
      start() {
        const { projectId } = openforge.context.getSnapshot()
        if (!projectId) return

        interval = setInterval(() => {
          void openforge.commands.invoke('sync-now', { projectId })
        }, 15 * 60 * 1000)

        void openforge.commands.invoke('sync-now', { projectId })
      },
      stop() {
        if (interval) clearInterval(interval)
        interval = null
      },
    }))
  },
})
```

## Task creation plus implementation run

Use the `tasks` capability for scheduler-style workflows. `tasks.create(...)` creates a backlog Task; `tasks.startImplementation(...)` asks OpenForge to launch its native Implementation Run. Plugins cannot override provider, model, permission mode, branch strategy, or checkout behavior through this API.

```ts
// src/backend.ts
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'

type StartPlannedWorkInput = {
  projectId: string
  prompt: string
  dependsOn?: string[]
}

type StartPlannedWorkOutput = {
  taskId: string
  sessionId: string
  workspacePath: string
}

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register<StartPlannedWorkInput, StartPlannedWorkOutput>({
      id: 'start-planned-work',
      title: 'Create Task and start Implementation Run',
      async handler({ projectId, prompt, dependsOn = [] }) {
        await openforge.tasks.configureStartPromptContribution({
          projectId,
          id: 'planner-review-context',
          enabled: true,
          content: '<plugin_review_guidance>Task {{taskId}} was created by the Planner plugin. Review the planner context before editing.</plugin_review_guidance>',
          order: 0,
        })

        const task = await openforge.tasks.create({
          initialPrompt: prompt,
          projectId,
          dependsOn,
          labelNames: ['plugin-created'],
        })

        const run = await openforge.tasks.startImplementation({ taskId: task.id })
        return {
          taskId: task.id,
          sessionId: run.sessionId,
          workspacePath: run.workspacePath,
        }
      },
    }))
  },
})
```

## Storage and configuration

Storage is JSON-only and namespaced by plugin id. Use storage for plugin data with a clear lifetime, and config APIs for user/project configuration values.

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register<{ projectId: string; taskId: string }, void>({
      id: 'save-review-preferences',
      title: 'Save review preferences',
      async handler({ projectId, taskId }) {
        await openforge.storage.global.set('ui', { compact: true })
        await openforge.storage.project(projectId).set('integration', { owner: 'acme', repo: 'web' })
        await openforge.storage.task(taskId).set('reviewState', { viewedFiles: ['README.md'] })

        await openforge.config.set('defaultLabel', 'plugin-created')
        await openforge.projectConfig.set('repoMapping', { owner: 'acme', repo: 'web' }, projectId)
      },
    }))
  },
})
```

When reading values, always handle `null` because keys may be unset:

```ts
const compactUi = await openforge.storage.global.get<{ compact: boolean }>('ui')
const defaultLabel = await openforge.config.get<string>('defaultLabel')
```

## Notifications

Use host-mediated notifications for user-facing status updates. Keep notification payloads JSON-compatible.

```ts
await openforge.notifications.notify({
  title: 'Planner sync finished',
  body: '3 backlog tasks were refreshed.',
  projectId,
  refreshed: 3,
})
```

## Open external URLs

Use `openforge.system.openUrl(url)` for external links. Do not call browser, Electron, or shell APIs directly from plugin code.

```ts
await openforge.system.openUrl('https://docs.openforge.local/plugins')
```

From a Svelte view:

```svelte
<script lang="ts">
  import type { PluginViewProps } from '@openforge-app/plugin-sdk/frontend'

  interface Props extends PluginViewProps {}

  let { api }: Props = $props()
</script>

<button onclick={() => api.system.openUrl('https://example.com/help')}>Open help</button>
```

## Testing recipe links

Do not duplicate the full testing guide in plugin docs. Start with [Testing OpenForge plugins](./testing.md) (`docs/plugins/testing.md`), then use the helper that matches the behavior under test:

- [`createOpenForgeRegistryFake`](./testing.md#choose-the-right-helper): activation tests, registration snapshots, same-plugin backend RPC, events, storage scoping, background lifecycle, and cleanup.
- [`createMockOpenForgeApi` / `createMockFrontendOpenForgeApi`](./testing.md#frontend-and-backend-mock-apis): units that only need a frontend-shaped API object.
- [`createMockBackendOpenForgeApi`](./testing.md#frontend-and-backend-mock-apis): units that only need a backend-shaped API object.
- [Task API tests](./testing.md#task-api-tests): assert `tasks.create(...)`, `tasks.startImplementation(...)`, status updates, and recorded calls without shelling out to OpenForge.
- [Backend RPC tests](./testing.md#backend-rpc): activate backend and frontend plugins against one registry fake, then call `registry.frontendApi.backend.invoke(...)`.
- [Background service tests](./testing.md#background-services): prove `start()` and `stop()` behavior and call `registry.disposeAll()`.

```ts
import { describe, expect, it } from 'vitest'
import frontendPlugin from '../src/frontend'
import backendPlugin from '../src/backend'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'

describe('planner plugin', () => {
  it('registers the stats view and backend method', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'acme.planner', projectId: 'P-1' })

    await registry.activateBackend(backendPlugin)
    await registry.activateFrontend(frontendPlugin)

    expect(registry.snapshot.views).toMatchObject([
      { id: 'stats', qualifiedId: 'acme.planner.stats', pluginId: 'acme.planner' },
    ])
    expect(registry.snapshot.backendMethods).toMatchObject([
      { id: 'getProjectStats', qualifiedId: 'acme.planner.getProjectStats' },
    ])

    await registry.disposeAll()
  })
})
```
