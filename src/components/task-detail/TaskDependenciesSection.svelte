<script lang="ts">
  import { onDestroy } from 'svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { removeTaskDependency } from '../../lib/ipc'
  import { refreshTaskRelationships } from '../../lib/tasksState'
  import type { TaskDependencySummary } from '../../lib/taskDependencies'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'

  interface Props {
    taskId: string
    items: TaskDependencySummary[]
    waitingDependencyCount: number
    onOpenRelatedTask?: (taskId: string, projectId: string | null) => void
  }
  let { taskId, items, waitingDependencyCount, onOpenRelatedTask }: Props = $props()
  let pendingRemovalId = $state<string | null>(null)
  let refreshNeededId = $state<string | null>(null)
  let error = $state<string | null>(null)
  let ownerId: string | undefined
  let generation = 0

  $effect(() => {
    if (ownerId !== taskId) {
      ownerId = taskId
      generation += 1
      pendingRemovalId = null
      refreshNeededId = null
      error = null
    }
  })
  onDestroy(() => { generation += 1 })

  async function execute(dependencyId: string, refreshOnly: boolean) {
    if (pendingRemovalId) return
    const capturedTaskId = taskId
    const request = ++generation
    pendingRemovalId = dependencyId
    error = null
    let committed = refreshOnly
    try {
      if (!refreshOnly) {
        await removeTaskDependency(capturedTaskId, dependencyId)
        committed = true
      }
      await refreshTaskRelationships(capturedTaskId, dependencyId)
      if (request === generation && taskId === capturedTaskId) refreshNeededId = null
    } catch (cause) {
      if (request !== generation || taskId !== capturedTaskId) return
      const detail = cause instanceof Error ? cause.message : String(cause)
      refreshNeededId = committed ? dependencyId : null
      error = committed ? `Dependency removed, but refresh failed: ${detail}` : `Could not remove dependency: ${detail}`
    } finally {
      if (request === generation && taskId === capturedTaskId) pendingRemovalId = null
    }
  }

  function remove(dependencyId: string) {
    if (!refreshNeededId) void execute(dependencyId, false)
  }
</script>

<TaskRelationshipDetailSection
  kind="dependencies" {taskId} {items} {waitingDependencyCount}
  {onOpenRelatedTask} pendingRemovalId={pendingRemovalId ?? refreshNeededId} onRemoveDependency={remove}
/>
{#if error}
  <div role="alert" class="text-xs text-of-danger">
    {error}
    {#if refreshNeededId}
      <Button size="xs" variant="ghost" disabled={pendingRemovalId !== null} onclick={() => { if (refreshNeededId) void execute(refreshNeededId, true) }}>
        Retry dependency refresh
      </Button>
    {/if}
  </div>
{/if}
