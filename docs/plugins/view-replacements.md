# Selectable dashboard and task detail providers

A replacement provider offers an alternative to one host view. The only supported targets are `project.dashboard` and `task.detail`. This does not replace the application shell, settings, rail, sidebar, task composer, or recovery controls.

An ordinary `views.register(...)` contribution remains an additive page in the rail or sidebar. It never claims a replacement target. The same local ID can be used in the View and replacement registries without changing the View's route or placement.

## Capability and registration

Use SDK version `0.3.0` or later and plugin API version `1`. Declare `viewReplacements` for either target and `tasks` if you read tasks or subscribe to their invalidations. Replacements are frontend-only. Add `appEnablement` and `enablement: 'app'` only if the package should stay active across projects; project enablement remains the default.

The following files form one buildable example. Their source lives in [`packages/plugin-sdk/scripts/fixtures/view-replacements`](../../packages/plugin-sdk/scripts/fixtures/view-replacements). The package contract check compiles the Svelte components, type-checks their scripts and registration against an installed SDK tarball, and checks that these examples match the fixtures. Runtime tests activate the same entry point and render its providers.

### metadata.ts

Copy the exported object into `package.json#openforge`. Build the frontend before installation. If your build emits CSS, declare its package-relative path in `frontendStyles` too.

```ts
import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'

// Copy this object into package.json#openforge after building frontend.js.
export const metadata = {
  id: 'acme.workspaces',
  apiVersion: 1,
  displayName: 'Example workspaces',
  description: 'Selectable project dashboard and task detail examples.',
  frontend: './dist/frontend.js',
  requires: ['viewReplacements', 'tasks'],
} satisfies OpenForgePackageMetadata
```

### frontend.ts

`register` accepts a component or a loader returning a component or `{ default: component }`. IDs are local to the plugin. Selection uses the qualified ID, such as `acme.workspaces.dashboard`. Keep those IDs stable across releases. A dashboard requires an icon; task detail registration does not use one. Titles must be non-empty, IDs must be unique within the replacement registry, and unsupported targets are rejected.

```ts
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(api, context) {
    context.subscriptions.add(api.viewReplacements.register({
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Task list',
      icon: 'layout-dashboard',
      component: () => import('./Dashboard.svelte'),
    }))
    context.subscriptions.add(api.viewReplacements.register({
      id: 'task-detail',
      target: 'task.detail',
      title: 'Task brief',
      component: () => import('./TaskDetail.svelte'),
    }))
  },
})
```

Use the [Svelte build contract](../plugin-authoring.md#svelte-build-and-css-contract), including the SDK Vite externalization helper, so the plugin shares the host's Svelte runtime.

## Target-specific props

Both components receive `api: FrontendOpenForgeAPI`, a render-scoped `context`, and the current `project: Project`. Use the props rather than a project captured during activation, especially in an app-enabled plugin.

| Target | Additional props |
| --- | --- |
| `project.dashboard` | `onOpenTask(taskId)`, `onComposeTask()`, `onOpenCommandSearch()` |
| `task.detail` | `task: TaskDetail`, `relatedTasks: TaskReference[]`, `onOpenTask(taskId, projectId?)`, `onEditTask()`, `onOpenTaskActions()`, `onRefreshTask()` |

`onOpenTask` and `onRefreshTask` can return promises. Handle rejection in plugin-owned UI. Use the host callbacks for navigation, editing, composition, command search, and task actions. The task detail callbacks already refer to the selected task. `context.taskId` identifies that task; the dashboard has no selected-task prop.

The dashboard reads its own bounded task data with `api.tasks.active(project.id)` or `api.tasks.completed(...)`. Task detail should render the supplied `task` and `relatedTasks`, not issue a duplicate detail read on mount. If it needs a refresh, call `onRefreshTask()` and let the host update the props.

### Dashboard.svelte

This example reads active tasks and refreshes after project invalidations. It ignores stale reads, displays read failures, and disposes its old subscription when the project or API changes. Updating the same project's name does not recreate the subscription.

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Disposable, TaskSummary } from '@openforge-app/plugin-sdk'
  import type { PluginProjectDashboardReplacementProps } from '@openforge-app/plugin-sdk/frontend'

  let { api, project, onOpenTask, onComposeTask, onOpenCommandSearch }: PluginProjectDashboardReplacementProps = $props()
  let tasks = $state<TaskSummary[]>([])
  let error = $state('')
  let loading = $state(true)
  let subscription: Disposable | undefined
  let currentProjectId: string | undefined
  let currentApi: typeof api | undefined
  let request = 0

  async function refresh(source: typeof api, projectId: string) {
    const revision = ++request
    loading = true
    error = ''
    try {
      const result = await source.tasks.active(projectId)
      if (revision === request) tasks = result.tasks
    } catch (cause) {
      if (revision === request) error = String(cause)
    } finally {
      if (revision === request) loading = false
    }
  }

  // Props can change without unmounting. Rebind only when the logical owner changes.
  $effect(() => {
    const source = api
    const projectId = project.id
    if (currentProjectId === projectId && currentApi === source) return
    subscription?.dispose()
    currentProjectId = projectId
    currentApi = source
    tasks = []
    subscription = source.tasks.onDidChange(projectId, () => { void refresh(source, projectId) })
    void refresh(source, projectId)
  })

  onDestroy(() => {
    ++request // Ignore reads that finish after this component is removed.
    subscription?.dispose()
  })

  async function openTask(taskId: string) {
    try {
      await onOpenTask(taskId)
    } catch (cause) {
      error = String(cause)
    }
  }
</script>

<section aria-label="Example dashboard">
  <h1>{project.name}</h1>
  <button onclick={onComposeTask}>New task</button>
  <button onclick={onOpenCommandSearch}>Search commands</button>
  {#if error}
    <p role="alert">{error}</p>
    <button onclick={() => refresh(api, project.id)}>Retry loading tasks</button>
  {/if}
  {#if loading}<p role="status">Loading tasks...</p>{/if}
  <ul>
    {#each tasks as task (task.id)}
      <li><button onclick={() => openTask(task.id)}>{task.title ?? task.id}</button></li>
    {/each}
  </ul>
</section>
```

### TaskDetail.svelte

This component renders host-provided task data. Its subscription asks the host to refresh only for this task or a project-wide invalidation. It owns no task runtime resources.

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Disposable } from '@openforge-app/plugin-sdk'
  import type { PluginTaskDetailReplacementProps } from '@openforge-app/plugin-sdk/frontend'

  let { api, project, task, relatedTasks, onOpenTask, onEditTask, onOpenTaskActions, onRefreshTask }: PluginTaskDetailReplacementProps = $props()
  let error = $state('')
  let subscription: Disposable | undefined
  let currentProjectId: string | undefined
  let currentTaskId: string | undefined
  let currentApi: typeof api | undefined
  let generation = 0

  async function run(action: () => void | Promise<void>) {
    const owner = generation
    error = ''
    try {
      await action()
    } catch (cause) {
      if (owner === generation) error = String(cause)
    }
  }

  $effect(() => {
    const source = api
    const projectId = project.id
    const taskId = task.id
    if (currentApi === source && currentProjectId === projectId && currentTaskId === taskId) return
    subscription?.dispose()
    ++generation
    currentApi = source
    currentProjectId = projectId
    currentTaskId = taskId
    error = ''
    subscription = source.tasks.onDidChange(projectId, event => {
      if (event.taskId === null || event.taskId === taskId) void run(onRefreshTask)
    })
  })

  onDestroy(() => {
    ++generation
    subscription?.dispose()
  })
</script>

<section aria-label="Example task detail">
  <h1>{task.title ?? task.id}</h1>
  <p>{task.prompt}</p>
  <button onclick={() => run(onEditTask)}>Edit task</button>
  <button onclick={() => run(onOpenTaskActions)}>Task actions</button>
  <button onclick={() => run(onRefreshTask)}>Refresh task</button>
  {#if error}<p role="alert">{error}</p>{/if}
  <ul aria-label="Related tasks">
    {#each relatedTasks as related (related.id)}
      <li><button onclick={() => run(() => onOpenTask(related.id, project.id))}>{related.title ?? related.id}</button></li>
    {/each}
  </ul>
</section>
```

## User selection and fallback

Registration only makes a provider available. Installing or enabling a plugin does not select it. Users choose the project dashboard and task detail providers independently in host settings. Global Settings sets each default; Project Settings can inherit that default, explicitly use Core, or choose an available provider. Core is the initial global default. A project override takes precedence over the global default.

Do not write host provider preferences from plugin activation or attempt to select yourself. A provider must be enabled and active in the current context before it can be used. A global selection does not enable the plugin in other projects.

If a selected contribution is missing, disabled, uninstalled, inactive, or fails to load or render, OpenForge falls back to Core for that target. It retains the configured provider ID rather than silently changing the user's preference. The provider can return when it becomes available again. A failure in one replacement does not remove healthy contributions or replace the other target's selection. Activation failures roll back registrations made during that activation.

The host owns provider selectors, Core recovery, reload, disable, uninstall, and diagnostic controls. Those controls remain reachable outside the replacement. Loader and render failures appear in plugin diagnostics. Svelte boundaries do not catch arbitrary asynchronous work or event-handler rejections; handle those errors in the component, as the examples do.

## Invalidation and cleanup

`api.tasks.onDidChange(projectId, handler)` is frontend-only and returns a `Disposable`. Events contain `projectId`, `taskId: string | null`, and a reason of `created`, `updated`, `completed`, `attention`, or `execution`. The host filters by project before delivery. A null task ID means project-wide invalidation.

Events are hints to refresh, not task snapshots or a lossless mutation log. The host may coalesce a burst. Re-read bounded data, or call the task detail refresh callback, rather than counting events as changes. Avoid polling and do not attach a second global host event listener.

Register activation-lifetime contributions and subscriptions with `context.subscriptions.add(...)`. A component subscription has a shorter lifetime. Dispose it when its logical project or task changes and in `onDestroy`, even if the plugin remains enabled. Do not release prop-keyed resources from an `$effect` cleanup. Compare identity explicitly, as these examples do. Ignore late asynchronous results after identity changes or unmount. Host deactivation, reload, and uninstall also stop task invalidation delivery, but that does not replace component cleanup when a user switches to Core.

## Host resource ownership

The plugin owns its rendered content, local state, and subscriptions. OpenForge keeps ownership of task selection, workspace resolution, task terminal session lifetimes, Run App registration and teardown, and application-level navigation and recovery. Replacing a view must not terminate a task, stop its terminals, or re-create host lifecycle services.

A task detail replacement changes the content region, not the outer task lifecycle. The host lifecycle stays mounted while providers change or fail; its resources end according to task identity and host teardown rules. Neither replacement receives a resource-disposal or host-lifecycle prop. Do not import renderer stores, `terminalSessionService`, Electron/preload APIs, or IPC internals. Other public SDK capabilities do not grant a replacement ownership of the host's resources.

## Verify an authoring change

From the repository root, run `pnpm packages:contract:check` to pack the SDK and compile the public authoring fixtures. Run `pnpm test src/lib/plugin/replacementAuthoring.integration.test.ts` for the examples' runtime behavior. The host replacement/recovery suites cover selection, fallback, and host lifecycle isolation; the existing View suites continue to cover rail/sidebar rendering and navigation.
