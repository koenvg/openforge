<script lang="ts">
  import {
    createTaskTerminalPaneLifecycle,
    formatTerminalTaskPaneWorkspaceLookupError,
    getTerminalTaskPaneWorkspaceStatusText,
    type TerminalTaskPaneWorkspaceLookupState,
  } from '@openforge/terminal-runtime'
  import { onDestroy, onMount } from 'svelte'
  import { getTaskWorkspace } from '../../lib/ipc'
  import { releaseAllForTask } from '../../lib/terminalPool'
  import { createTerminalShortcutController } from '../../lib/terminalShortcutController'
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

  const terminalShortcuts = createTerminalShortcutController({ shortcutRoot: () => shortcutRoot })
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  const workspaceStatusText = $derived.by(() =>
    getTerminalTaskPaneWorkspaceStatusText(workspaceLookupState),
  )

  const terminalPaneLifecycle = createTaskTerminalPaneLifecycle({
    controller,
    getTaskWorkspace,
    getWorkspacePath: (workspace) => workspace?.workspace_path ?? null,
    registerController: registerTerminalTaskPaneController,
    unregisterController: unregisterTerminalTaskPaneController,
    releaseAllForTask,
    setWorkspacePath: (path) => { workspacePath = path },
    onWorkspaceLoading: () => {
      workspaceLookupState = 'loading'
      workspaceLookupError = null
    },
    onWorkspaceResolved: (_taskId, path) => {
      workspaceLookupState = path === null ? 'unavailable' : 'ready'
      workspaceLookupError = null
    },
    onWorkspaceLookupError: (_taskId, error) => {
      workspaceLookupState = 'error'
      workspaceLookupError = formatTerminalTaskPaneWorkspaceLookupError(error)
    },
  })

  function retryWorkspaceLookup(): void {
    terminalPaneLifecycle.retryWorkspaceLookup()
  }

  $effect(() => {
    terminalPaneLifecycle.syncTask(taskId)
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())

  onDestroy(() => {
    terminalPaneLifecycle.destroy()
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
