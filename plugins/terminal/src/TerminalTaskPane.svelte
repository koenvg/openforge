<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getTaskWorkspace } from './lib/ipc'
  import { releaseAllForTask } from './lib/terminalPool'
  import { createTerminalShortcutController } from './terminalShortcutController'
  import TerminalTabs from './TerminalTabs.svelte'
  import { registerTerminalTaskPaneController, unregisterTerminalTaskPaneController } from './terminalTaskPaneController'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let previousTaskId = $state<string | null>(null)
  let workspaceLookupToken = 0

  const terminalShortcuts = createTerminalShortcutController()
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  function releaseTaskPaneTerminalResources(taskIdToRelease: string) {
    unregisterTerminalTaskPaneController(taskIdToRelease, controller)
    releaseAllForTask(taskIdToRelease)
  }

  $effect(() => {
    if (taskId === previousTaskId) {
      return
    }

    if (previousTaskId !== null) {
      releaseTaskPaneTerminalResources(previousTaskId)
    }

    previousTaskId = taskId
    workspacePath = null
    registerTerminalTaskPaneController(taskId, controller)

    const lookupToken = ++workspaceLookupToken
    void getTaskWorkspace(taskId).then((workspace) => {
      if (lookupToken !== workspaceLookupToken || previousTaskId !== taskId) return
      workspacePath = workspace?.workspace_path ?? null
    })
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    workspaceLookupToken += 1
    const taskIdToRelease = previousTaskId ?? taskId
    releaseTaskPaneTerminalResources(taskIdToRelease)
    previousTaskId = null
  })
</script>

{#if workspacePath !== null}
  <div class="flex flex-col flex-1 overflow-hidden h-full">
    <TerminalTabs
      bind:this={terminalTabsRef}
      taskId={taskId}
      {workspacePath}
      onTabChange={null}
      onTabCountChange={null}
    />
  </div>
{/if}
