# Testing OpenForge plugins

Use `@openforge-app/plugin-sdk/testing` for focused unit and integration-style tests around plugin activation, registered contributions, and host API calls. The testing entry point is part of the public SDK contract; do not import test helpers from `@openforge-app/plugin-sdk/src/...` or `dist/...`.

The helpers are designed for Vitest tests that run plugin frontend and backend entry points without starting the OpenForge desktop app.

```ts
import { describe, expect, it } from 'vitest'

import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import {
  createMockBackendOpenForgeApi,
  createMockFrontendOpenForgeApi,
  createMockOpenForgeApi,
  createOpenForgeRegistryFake,
} from '@openforge-app/plugin-sdk/testing'
```

## Choose the right helper

| Helper | Use it when |
| --- | --- |
| `createOpenForgeRegistryFake(options)` | You need a shared fake host for frontend and backend activation, registration assertions, backend RPC, events, storage, or lifecycle cleanup. |
| `createMockOpenForgeApi(options)` | You only need a standalone `FrontendOpenForgeAPI` mock. This is an alias for `createMockFrontendOpenForgeApi`. |
| `createMockFrontendOpenForgeApi(options)` | You want to unit-test code that receives a `FrontendOpenForgeAPI` but do not need backend registrations from the same fake host. |
| `createMockBackendOpenForgeApi(options)` | You want to unit-test code that receives a `BackendOpenForgeAPI` but do not need a frontend bridge from the same fake host. |

Prefer `createOpenForgeRegistryFake` for plugin activation tests because it exposes `registry.frontendApi`, `registry.backendApi`, activation helpers, call history, and a `snapshot` of registered contributions.

```ts
it('activates frontend contributions and records command calls', async () => {
  const Component = (() => null) as never
  const registry = createOpenForgeRegistryFake({ pluginId: 'github', projectId: 'P-1' })

  const plugin = defineFrontendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.views.register({
        id: 'prs',
        title: 'Pull Requests',
        icon: 'git-pull-request',
        placement: 'rail',
        component: Component,
      }))

      context.subscriptions.add(openforge.commands.register({
        id: 'refresh',
        title: 'Refresh pull requests',
        handler: async (input: { force?: boolean }) => ({ refreshed: input.force === true }),
      }))
    },
  })

  await registry.activateFrontend(plugin)

  expect(registry.snapshot.views).toMatchObject([
    { id: 'prs', qualifiedId: 'github.prs', pluginId: 'github', projectId: 'P-1' },
  ])

  await expect(registry.frontendApi.commands.invoke('refresh', { force: true }))
    .resolves.toEqual({ refreshed: true })
  expect(registry.frontendApi.__testing.calls.commandInvocations).toEqual([
    { id: 'refresh', qualifiedId: 'github.refresh', payload: { force: true } },
  ])
})
```

## Frontend and backend mock APIs

The registry creates both runtime API shapes from one fake host:

- `registry.frontendApi` includes frontend-only areas such as `views`, canonical `taskUI`, the deprecated `taskPane` tab alias, `settings`, `navigation`, and `backend.invoke()`.
- `registry.snapshot.taskUISections` records section metadata and component sources; disposing the returned registrations removes them just like other runtime contributions.
- `registry.backendApi` includes backend-only areas such as `backend.registerMethod()` and `background.register()`.
- Both APIs share common host areas: commands, events, storage, tasks, projects, fs, shell, notifications, attention, system, config, and projectConfig.

Use standalone mocks when a unit under test only needs one API object:

```ts
it('records simple host calls with a standalone frontend API mock', async () => {
  const api = createMockOpenForgeApi({ pluginId: 'demo', projectId: 'P-1' })

  await api.system.openUrl('https://example.com')
  await api.system.writeClipboardText('Reviewer brief')
  await api.notifications.notify({ title: 'Ready' })

  expect(api.__testing.calls.openUrl).toEqual(['https://example.com'])
  expect(api.__testing.calls.clipboardWrites).toEqual(['Reviewer brief'])
  expect(api.__testing.calls.notify).toEqual([{ title: 'Ready' }])
})

it('can create isolated frontend and backend API mocks', () => {
  const frontendApi = createMockFrontendOpenForgeApi({ pluginId: 'frontend-only' })
  const backendApi = createMockBackendOpenForgeApi({ pluginId: 'backend-only' })

  expect(frontendApi.context.getSnapshot()).toEqual({ pluginId: 'frontend-only', projectId: null })
  expect(backendApi.context.getSnapshot()).toEqual({ pluginId: 'backend-only', projectId: null })
})
```

Standalone mocks each own their own registry. If a frontend test needs to invoke a backend method registered by the backend plugin, use a single `createOpenForgeRegistryFake()` instance instead.

## Registration assertions

Local contribution IDs are automatically namespaced as `<pluginId>.<id>`. Assert against qualified IDs when you need to prove the host-visible registration key.

```ts
it('qualifies commands and exposes discoverable command descriptors', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'planner' })

  await registry.activateFrontend(defineFrontendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.commands.register({
        id: 'schedule',
        title: 'Schedule task',
        discoverable: false,
        handler: async () => ({ ok: true }),
      }))
    },
  }))

  expect(await registry.frontendApi.commands.list()).toMatchObject([
    { id: 'schedule', qualifiedId: 'planner.schedule', discoverable: false },
  ])
  expect(registry.snapshot.commands).toMatchObject([
    { id: 'schedule', qualifiedId: 'planner.schedule', pluginId: 'planner' },
  ])
})
```

The fake also validates common registration mistakes. It throws for empty local IDs, invalid local IDs, the reserved `openforge.*` namespace, duplicate contribution IDs, missing titles on UI/command registrations, and missing handler/component functions.

```ts
it('rejects duplicate command registrations in the same namespace', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'planner' })

  const plugin = defineFrontendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.commands.register({
        id: 'schedule',
        title: 'Schedule task',
        handler: async () => undefined,
      }))
      context.subscriptions.add(openforge.commands.register({
        id: 'schedule',
        title: 'Schedule again',
        handler: async () => undefined,
      }))
    },
  })

  await expect(registry.activateFrontend(plugin)).rejects.toThrow(
    'Duplicate runtime contribution id: planner.schedule',
  )
})
```

## Testing application themes

Test at the public `openforge.themes.register` boundary. Activate the real frontend entry with `createOpenForgeRegistryFake({ pluginId, packageMetadata })`, where metadata declares `enablement: 'app'` and `requires: ['appEnablement', 'themes']`. Do not omit metadata, or the capability gate should reject registration. Use the complete palette from the [installable example](../../src/lib/plugin/fixtures/selected-theme/README.md), not placeholder values or a cast that hides missing tokens.

Theme IDs use a colon, unlike command IDs. Assert `registry.snapshot.themes` contains `qualifiedId: 'selected-theme-fixture:paper'`, `appearance: 'light'`, and the expected palette. Calls are recorded in `registry.calls.themeRegistrations`. Call `registry.disposeAll()` and assert that no themes remain. Also cover missing capability, project enablement, duplicate local IDs, incomplete tokens, and invalid stylesheet paths when testing the contract itself.

A registry fake does not load CSS, render settings, persist a host selection, or restart Electron. Use host integration tests for those boundaries. The existing suites are:

```sh
pnpm exec vitest run packages/plugin-sdk/src/testing.themes.test.ts src/lib/plugin/pluginRegistry.themeStylesheets.test.ts src/lib/themeStylesheetLifecycle.test.ts
pnpm --filter @openforge-app/plugin-sdk check:entrypoints
pnpm packages:metadata:check
pnpm packages:contract:check
pnpm packages:pack:dry-run
```

The published contract installs packed SDK artifacts into clean consumers, type-checks authoring fixtures, compiles public UI components, builds an external plugin, and checks the shared Svelte runtime. Build the actual plugin and inspect its package as well: `npm pack --dry-run` must include the frontend entry, imported local token files, ordinary view CSS, and every selected stylesheet. Installing does not build missing artifacts.

Run the following in an isolated development or packaged Electron app. Use a disposable copy of the example for destructive failure cases, not a user's active plugin package.

| Scenario | Required observations |
| --- | --- |
| Built-in light and dark | Select through settings; verify labels, focus, contrast, disabled states, dialogs and menus at normal and reduced desktop widths. |
| Token-only contribution | Omit `stylesheets` in a copied example. Enabling lists the owned theme without changing selection. Selecting updates mounted controls without losing field state. |
| Selected CSS contribution | All candidate files load before activation. Switching away removes selected CSS but keeps ordinary view CSS. |
| Restart | The same qualified ID and presentation return after app-level activation. A missing saved ID falls back to built-in light and remains light after another restart. |
| Reload and disable | Reinstall rebuilt artifacts before reload. Successful reload restores the selected contribution; disable removes it and its CSS and persists built-in light. |
| Broken theme | Test invalid tokens, a missing CSS artifact, and valid but disruptive CSS separately. Validation/load failure must leave a valid theme. Recover from disruptive CSS through app-level CLI disable. |
| Mounted consumers | Keep a terminal, diff, and Mermaid preview open across changes. Verify palette and explicit appearance, including a dark ID without `dark` and a light ID containing it. |
| Keyboard and reduced motion | Use Tab, arrows, Enter, and Escape; verify focus remains visible and returns after overlays. Enable reduced motion and check computed transitions, not just screenshots. |

Record app mode, revision, platform, commands, observed results, console errors, and artifact paths. Mark each unexercised case as unverified. Browser-only fixtures and jsdom-controlled stylesheet events are useful but do not satisfy the Electron release matrix.

## Lifecycle cleanup

Registration methods return disposables. Plugin code should add those disposables to `context.subscriptions`; tests should call `registry.disposeAll()` to simulate deactivation and assert cleanup.

`disposeAll()` disposes backend subscriptions first, then frontend subscriptions, in reverse subscription order inside each runtime.

```ts
it('removes registered contributions on disposeAll', async () => {
  const Component = (() => null) as never
  const registry = createOpenForgeRegistryFake({ pluginId: 'cleanup' })

  await registry.activateFrontend(defineFrontendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.views.register({
        id: 'dashboard',
        title: 'Dashboard',
        icon: 'layout-dashboard',
        placement: 'rail',
        component: Component,
      }))
    },
  }))

  expect(registry.snapshot.views).toHaveLength(1)

  await registry.disposeAll()

  expect(registry.snapshot.views).toEqual([])
})
```

For one-off cleanup functions, add the function directly to `context.subscriptions`:

```ts
it('runs cleanup callbacks registered with the subscription sink', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'cleanup-callbacks' })
  const cleaned: string[] = []

  await registry.activateFrontend(defineFrontendPlugin({
    activate(_openforge, context) {
      context.subscriptions.add(() => cleaned.push('frontend-cleaned'))
    },
  }))

  await registry.disposeAll()

  expect(cleaned).toEqual(['frontend-cleaned'])
})
```

## Storage scoping

The fake uses in-memory plugin storage and records each `get`, `set`, and `delete` call. Storage scopes are isolated by scope kind and ID:

- `openforge.storage.global` stores app-wide plugin values.
- `openforge.storage.project(projectId)` stores values for one project ID.
- `openforge.storage.task(taskId)` stores values for one task ID.

```ts
it('keeps global, project, and task storage separate', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'notes', projectId: 'P-1', taskId: 'T-1' })
  const { storage } = registry.frontendApi

  await storage.global.set('draft', 'global')
  await storage.project('P-1').set('draft', 'project')
  await storage.task('T-1').set('draft', 'task')

  await expect(storage.global.get('draft')).resolves.toBe('global')
  await expect(storage.project('P-1').get('draft')).resolves.toBe('project')
  await expect(storage.task('T-1').get('draft')).resolves.toBe('task')

  expect(registry.frontendApi.__testing.calls.storageSets).toEqual([
    { scope: 'global', scopeId: null, key: 'draft', value: 'global' },
    { scope: 'project', scopeId: 'P-1', key: 'draft', value: 'project' },
    { scope: 'task', scopeId: 'T-1', key: 'draft', value: 'task' },
  ])
})
```

`projectId` and `taskId` options set the context snapshot defaults. Storage project/task scopes still require explicit IDs, matching the production SDK API.

## Task API tests

Use the task API fake to test plugin-owned task automation without shelling out to the OpenForge CLI. The fake records calls and returns deterministic placeholder data.

```ts
it('records task creation, status updates, and implementation starts', async () => {
  const api = createMockOpenForgeApi({ pluginId: 'triage', projectId: 'P-1' })

  const task = await api.tasks.create({
    initialPrompt: 'Investigate flaky checkout tests',
    projectId: 'P-1',
    dependsOn: ['KVG-1'],
    labelNames: ['testing'],
  })
  await api.tasks.updateStatus(task.id, 'active')
  const run = await api.tasks.startImplementation({ taskId: task.id })

  expect(task).toMatchObject({
    id: 'mock-task-1',
    initial_prompt: 'Investigate flaky checkout tests',
    project_id: 'P-1',
    status: 'backlog',
    depends_on: ['KVG-1'],
  })
  expect(run).toEqual({
    taskId: 'mock-task-1',
    workspacePath: '/mock-workspace',
    sessionId: 'mock-session',
  })
  expect(api.__testing.calls.taskCreations).toEqual([
    {
      initialPrompt: 'Investigate flaky checkout tests',
      projectId: 'P-1',
      dependsOn: ['KVG-1'],
      labelNames: ['testing'],
    },
  ])
  expect(api.__testing.calls.taskStatusUpdates).toEqual([
    { taskId: 'mock-task-1', status: 'active' },
  ])
  expect(api.__testing.calls.taskImplementationStarts).toEqual([
    { taskId: 'mock-task-1' },
  ])
})
```

By default, `tasks.active(projectId)` returns empty `tasks` and `related` arrays, `tasks.completed(projectId)` returns an empty fixed page, and `tasks.detail(projectId, taskId)` resolves to `null`. The deprecated version 1 `tasks.list()` and `tasks.get()` fakes preserve their old empty-array and null behavior until version 2. Workspace and session lookups also return `null`. Seed the registry or wrap the API behind a plugin-owned test double when a test needs richer fixtures.
Use `registry.emitTaskChange({ projectId, taskId, reason })` to test `tasks.onDidChange` handlers. The fake applies the same Project filter as the host. Call `subscription.dispose()` or `registry.disposeAll()` to test explicit and lifecycle cleanup.

## Review Threads

The fake stores Review Threads in memory, so a test can create and list a thread without a running host. It applies the same structural checks as the host and rejects a bad write with a message naming the offending field.

```ts
it('creates and lists a line-anchored Review Thread', async () => {
  const api = createMockOpenForgeApi({ pluginId: 'reviewer' })
  const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }

  const thread = await api.reviewThreads.create({
    ...scope,
    anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' },
    origin: 'plugin',
    body: 'Needs a null check',
  })
  await api.reviewThreads.reply({ threadId: thread.id, role: 'human', body: 'Fixed' })

  await expect(api.reviewThreads.list(scope)).resolves.toHaveLength(1)
})
```

Use `registry.emitReviewThreadChange(scope)` to test `reviewThreads.onDidChange` handlers. The fake applies the same scope filter as the host and the notification carries no thread snapshot.

## Backend RPC

Backend methods registered through `openforge.backend.registerMethod()` are callable through the matching frontend fake's `openforge.backend.invoke()` when both runtimes use the same registry.

```ts
it('invokes backend RPC methods through the frontend bridge', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'sync', projectId: 'P-1' })

  await registry.activateBackend(defineBackendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
        handler: async (input: { projectId: string }) => ({
          pluginId: context.pluginId,
          synced: input.projectId,
        }),
      }))
    },
  }))

  await expect(registry.frontendApi.backend.invoke('syncProject', { projectId: 'P-1' }))
    .resolves.toEqual({ pluginId: 'sync', synced: 'P-1' })
  expect(registry.frontendApi.__testing.calls.backendInvocations).toEqual([
    { method: 'syncProject', qualifiedId: 'sync.syncProject', payload: { projectId: 'P-1' } },
  ])
  expect(registry.snapshot.backendMethods).toMatchObject([
    { id: 'syncProject', qualifiedId: 'sync.syncProject', pluginId: 'sync' },
  ])
})
```

The bridge reports `state: 'ready'`, `whenReady()` resolves immediately, and `onReady(handler)` calls the handler immediately.

## Background services

Backend plugins can register background services with `global`, `project`, or `task` scope. In the registry fake, `activateBackend()` starts services registered during that activation and marks them as `started` in the snapshot. `disposeAll()` calls each started service's optional `stop()` handler.

```ts
it('starts background services during backend activation and stops them on cleanup', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'sync', projectId: 'P-1' })
  const events: string[] = []

  await registry.activateBackend(defineBackendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.background.register({
        id: 'poller',
        scope: 'project',
        start: async () => {
          events.push('started')
          await openforge.storage.project('P-1').set('lastRun', { ok: true })
        },
        stop: async () => {
          events.push('stopped')
        },
      }))
    },
  }))

  expect(events).toEqual(['started'])
  expect(registry.snapshot.backgroundServices).toMatchObject([
    { id: 'poller', qualifiedId: 'sync.poller', scope: 'project', started: true },
  ])
  await expect(registry.backendApi.storage.project('P-1').get('lastRun'))
    .resolves.toEqual({ ok: true })

  await registry.disposeAll()

  expect(events).toEqual(['started', 'stopped'])
})
```

## Events across runtimes

The shared registry lets frontend and backend plugins communicate through local or global events in tests.

```ts
it('delivers local events between frontend and backend fakes', async () => {
  const registry = createOpenForgeRegistryFake({ pluginId: 'sync' })
  const received: unknown[] = []

  registry.frontendApi.events.on('sync.started', (payload) => received.push(payload))

  await registry.activateBackend(defineBackendPlugin({
    activate(openforge) {
      void openforge.events.emit('sync.started', { projectId: 'P-1' })
    },
  }))

  expect(received).toEqual([{ projectId: 'P-1' }])
  expect(registry.backendApi.__testing.calls.emittedEvents).toEqual([
    { event: 'sync.started', qualifiedEvent: 'sync.sync.started', payload: { projectId: 'P-1' } },
  ])
})
```

Use `events.onGlobal()` and `events.emitGlobal()` only for already-qualified cross-plugin event names. Local events are namespaced to the current plugin ID.

## Practical checklist

For each plugin entry point, write focused tests that prove:

1. Activation registers the expected commands, views, task-pane tabs, settings sections, backend methods, and background services.
2. Local IDs are qualified under the plugin namespace, and duplicate or invalid registrations fail fast.
3. Command handlers, backend RPC handlers, and background service `start()`/`stop()` logic perform the intended host API calls.
4. Storage reads and writes use the intended `global`, `project(projectId)`, or `task(taskId)` scope.
5. Task automation uses the SDK `tasks` API and asserts against recorded calls instead of calling the OpenForge CLI.
6. Tests call `disposeAll()` when they activate a plugin through the registry and assert important cleanup behavior.
