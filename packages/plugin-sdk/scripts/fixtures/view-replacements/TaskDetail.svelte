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
