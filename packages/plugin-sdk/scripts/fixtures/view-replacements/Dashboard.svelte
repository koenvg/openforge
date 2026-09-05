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
