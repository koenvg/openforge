<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    PluginProjectDashboardReplacementProps,
    PluginTaskDetailReplacementProps,
  } from '@openforge-app/plugin-sdk/frontend'

  let { api, project, task }: PluginProjectDashboardReplacementProps & Partial<PluginTaskDetailReplacementProps> = $props()
  let target = $derived(task ? 'task.detail' : 'project.dashboard')
  let crashed = $state(false)

  onMount(() => {
    const identity = `${target}:${project.id}:${task?.id ?? ''}`
    const subscription = api.tasks.onDidChange(project.id, () => {
      window.dispatchEvent(new CustomEvent('replacement-delivery', { detail: identity }))
    })
    return () => {
      subscription.dispose()
      window.dispatchEvent(new CustomEvent('replacement-disposed', { detail: identity }))
    }
  })

  $effect(() => {
    if (crashed) throw new Error(`Broken ${target}`)
  })
</script>

<div data-testid={target}>
  {project.id}:{task?.id ?? ''}
  <button onclick={() => { crashed = true }}>Crash {target}</button>
</div>
