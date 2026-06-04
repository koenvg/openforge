<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { PluginTaskPaneProps } from '@openforge/plugin-sdk/frontend'
  import { bindTerminalPluginApi } from './lib/ipc'
  import { createTerminalShortcutController } from './terminalShortcutController'
  import TerminalTabs from './TerminalTabs.svelte'
  import { registerTerminalTaskPaneController, unregisterTerminalTaskPaneController } from './terminalTaskPaneController'

  interface Props extends PluginTaskPaneProps {}

  let { api, taskId }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let previousTaskId = $state<string | null>(null)

  const terminalShortcuts = createTerminalShortcutController()
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    bindTerminalPluginApi(api)
  })

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  $effect(() => {
    if (taskId === previousTaskId) {
      return
    }

    if (previousTaskId !== null) {
      unregisterTerminalTaskPaneController(previousTaskId, controller)
    }

    previousTaskId = taskId
    workspacePath = null
    registerTerminalTaskPaneController(taskId, controller)

    void api.tasks.getWorkspace(taskId).then((workspace) => {
      workspacePath = workspace?.workspace_path ?? null
    })
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    unregisterTerminalTaskPaneController(taskId, controller)
  })
</script>

{#if workspacePath !== null}
  <div class="flex flex-col flex-1 overflow-hidden h-full">
    <TerminalTabs
      bind:this={terminalTabsRef}
      {api}
      taskId={taskId}
      {workspacePath}
      onTabChange={null}
      onTabCountChange={null}
    />
  </div>
{/if}
