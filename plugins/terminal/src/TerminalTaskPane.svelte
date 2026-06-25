<script lang="ts">
  import {
    createLoadingTerminalTaskPaneWorkspaceSnapshot,
    createTerminalTaskPaneWorkspaceLookupController,
    getTerminalTaskPaneWorkspaceStatusText,
    type TerminalTaskPaneWorkspaceLookupState,
    type TerminalTaskPaneWorkspaceSnapshot,
  } from '@openforge/terminal-runtime'
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
  let workspaceLookupState = $state<TerminalTaskPaneWorkspaceLookupState>('loading')
  let workspaceLookupError = $state<string | null>(null)
  let shortcutRoot = $state<HTMLElement | null>(null)

  const workspaceLookup = createTerminalTaskPaneWorkspaceLookupController()
  const terminalShortcuts = createTerminalShortcutController({ shortcutRoot: () => shortcutRoot })
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  const workspaceStatusText = $derived.by(() =>
    getTerminalTaskPaneWorkspaceStatusText(workspaceLookupState),
  )

  function releaseTaskPaneTerminalResources(taskIdToRelease: string) {
    unregisterTerminalTaskPaneController(taskIdToRelease, controller)
    releaseAllForTask(taskIdToRelease)
  }

  function applyWorkspaceLookupSnapshot(snapshot: TerminalTaskPaneWorkspaceSnapshot): void {
    workspacePath = snapshot.workspacePath
    workspaceLookupState = snapshot.workspaceLookupState
    workspaceLookupError = snapshot.workspaceLookupError
  }

  function loadWorkspaceForTask(taskIdToLoad: string): void {
    const request = workspaceLookup.startLookup(taskIdToLoad)
    applyWorkspaceLookupSnapshot(createLoadingTerminalTaskPaneWorkspaceSnapshot())

    void getTaskWorkspace(taskIdToLoad)
      .then((workspace) => {
        const snapshot = workspaceLookup.resolveLookup(request, workspace)
        if (snapshot === null) return
        applyWorkspaceLookupSnapshot(snapshot)
      })
      .catch((error: unknown) => {
        const snapshot = workspaceLookup.rejectLookup(request, error)
        if (snapshot === null) return
        applyWorkspaceLookupSnapshot(snapshot)
      })
  }

  function retryWorkspaceLookup(): void {
    loadWorkspaceForTask(taskId)
  }

  $effect(() => {
    const taskSwitch = workspaceLookup.switchTask(taskId)
    if (!taskSwitch.changed) {
      return
    }

    if (taskSwitch.previousTaskId !== null) {
      releaseTaskPaneTerminalResources(taskSwitch.previousTaskId)
    }

    registerTerminalTaskPaneController(taskId, controller)
    loadWorkspaceForTask(taskId)
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    workspaceLookup.cancelLookups()
    const taskIdToRelease = workspaceLookup.getActiveTaskId() ?? taskId
    releaseTaskPaneTerminalResources(taskIdToRelease)
    workspaceLookup.clearTask()
  })
</script>

<div bind:this={shortcutRoot} class="flex flex-col flex-1 overflow-hidden h-full">
  <p class="sr-only" role="status" aria-live="polite">{workspaceStatusText}</p>

  {#if workspaceLookupState === 'ready' && workspacePath !== null}
    <TerminalTabs
      bind:this={terminalTabsRef}
      taskId={taskId}
      {workspacePath}
      onTabChange={null}
      onTabCountChange={null}
    />
  {:else if workspaceLookupState === 'loading'}
    <div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-base-content/70">
      <div class="flex flex-col items-center gap-3">
        <span class="loading loading-spinner loading-md" aria-hidden="true"></span>
        <p>{workspaceStatusText}</p>
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center p-6 text-center">
      <div class="max-w-sm space-y-3">
        <p class="font-medium">{workspaceStatusText}</p>
        {#if workspaceLookupState === 'error' && workspaceLookupError !== null}
          <p class="text-sm text-base-content/70">{workspaceLookupError}</p>
        {:else}
          <p class="text-sm text-base-content/70">Start or repair the task workspace, then retry loading the terminal.</p>
        {/if}
        <button type="button" class="btn btn-sm btn-primary" onclick={retryWorkspaceLookup}>Retry workspace lookup</button>
      </div>
    </div>
  {/if}
</div>
