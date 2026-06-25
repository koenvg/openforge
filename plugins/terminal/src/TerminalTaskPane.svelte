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

  type WorkspaceLookupState = 'loading' | 'ready' | 'unavailable' | 'error'

  let { taskId }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let workspaceLookupState = $state<WorkspaceLookupState>('loading')
  let workspaceLookupError = $state<string | null>(null)
  let previousTaskId = $state<string | null>(null)
  let workspaceLookupToken = 0
  let shortcutRoot = $state<HTMLElement | null>(null)

  const terminalShortcuts = createTerminalShortcutController({ shortcutRoot: () => shortcutRoot })
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  const workspaceStatusText = $derived.by(() => {
    if (workspaceLookupState === 'loading') return 'Loading terminal workspace…'
    if (workspaceLookupState === 'unavailable') return 'Terminal workspace unavailable for this task.'
    if (workspaceLookupState === 'error') return 'Terminal workspace lookup failed.'
    return 'Terminal workspace ready.'
  })

  function releaseTaskPaneTerminalResources(taskIdToRelease: string) {
    unregisterTerminalTaskPaneController(taskIdToRelease, controller)
    releaseAllForTask(taskIdToRelease)
  }

  function formatWorkspaceLookupError(error: unknown): string {
    return error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Unable to resolve the workspace for this task.'
  }

  function loadWorkspaceForTask(taskIdToLoad: string): void {
    const lookupToken = ++workspaceLookupToken
    workspacePath = null
    workspaceLookupState = 'loading'
    workspaceLookupError = null

    void getTaskWorkspace(taskIdToLoad)
      .then((workspace) => {
        if (lookupToken !== workspaceLookupToken || previousTaskId !== taskIdToLoad) return
        const resolvedWorkspacePath = workspace?.workspace_path ?? null
        workspacePath = resolvedWorkspacePath
        workspaceLookupState = resolvedWorkspacePath === null ? 'unavailable' : 'ready'
      })
      .catch((error: unknown) => {
        if (lookupToken !== workspaceLookupToken || previousTaskId !== taskIdToLoad) return
        workspacePath = null
        workspaceLookupState = 'error'
        workspaceLookupError = formatWorkspaceLookupError(error)
      })
  }

  function retryWorkspaceLookup(): void {
    loadWorkspaceForTask(taskId)
  }

  $effect(() => {
    if (taskId === previousTaskId) {
      return
    }

    if (previousTaskId !== null) {
      releaseTaskPaneTerminalResources(previousTaskId)
    }

    previousTaskId = taskId
    registerTerminalTaskPaneController(taskId, controller)
    loadWorkspaceForTask(taskId)
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    workspaceLookupToken += 1
    const taskIdToRelease = previousTaskId ?? taskId
    releaseTaskPaneTerminalResources(taskIdToRelease)
    previousTaskId = null
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
