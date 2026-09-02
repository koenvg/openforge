<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { PluginTaskDetailReplacementProps } from '@openforge-app/plugin-sdk/frontend'

  let { project, task }: PluginTaskDetailReplacementProps = $props()

  onMount(() => {
    window.dispatchEvent(new CustomEvent('task-workspace-mounted', {
      detail: `${project.id}:${task.id}`,
    }))
  })

  onDestroy(() => {
    window.dispatchEvent(new CustomEvent('task-workspace-destroyed', {
      detail: `${project.id}:${task.id}`,
    }))
  })
</script>

<div data-testid="lifecycle-task-workspace">{project.id}:{task.id}</div>
