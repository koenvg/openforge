<script lang="ts">
  import { onDestroy, onMount, type Component } from 'svelte'
  import {
    TERMINAL_TASK_PANE_KEYBOARD_FOCUS_PATH_TEXT,
    TERMINAL_TASK_PANE_WORKSPACE_RECOVERY_TEXT,
  } from './terminalControls'
  import { createTaskTerminalPaneLifecycle } from './taskTerminalPaneLifecycle'
  import {
    formatTerminalTaskPaneWorkspaceLookupError,
    getTerminalTaskPaneWorkspaceStatusText,
    type TerminalTaskPaneWorkspaceLookupState,
  } from './taskPaneWorkspaceLookup'
  import {
    createTerminalShortcutController,
    type TerminalTabsShortcutTarget,
  } from './terminalShortcutController'
  import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'
  import DefaultTerminalTabsSurface from './TerminalTabsSurface.svelte'

  interface Props {
    adapter: TerminalSurfaceAdapter
    taskId: string
    shortcutHintsVisible: boolean
    showShellReadyAffordance?: boolean
    TerminalTabsComponent?: Component<Record<string, unknown>>
  }

  let {
    adapter,
    taskId,
    shortcutHintsVisible,
    showShellReadyAffordance = false,
    TerminalTabsComponent = DefaultTerminalTabsSurface,
  }: Props = $props()
  let workspacePath = $state<string | null>(null)
  let workspaceLookupState = $state<TerminalTaskPaneWorkspaceLookupState>('loading')
  let workspaceLookupError = $state<string | null>(null)
  let shortcutRoot = $state<HTMLElement | null>(null)

  const terminalShortcuts = createTerminalShortcutController({ shortcutRoot: () => shortcutRoot })
  const controller = terminalShortcuts.controller
  let terminalTabsRef = $state<TerminalTabsShortcutTarget | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  const workspaceStatusText = $derived.by(() =>
    getTerminalTaskPaneWorkspaceStatusText(workspaceLookupState),
  )

  const terminalPaneLifecycle = createTaskTerminalPaneLifecycle({
    controller,
    getTaskWorkspace: (currentTaskId) => adapter.getTaskWorkspace(currentTaskId),
    getWorkspacePath: (workspace) => adapter.getWorkspacePath(workspace),
    registerController: (currentTaskId, currentController) => adapter.registerTaskPaneController(currentTaskId, currentController),
    unregisterController: (currentTaskId, currentController) => adapter.unregisterTaskPaneController(currentTaskId, currentController),
    releaseAllForTask: (currentTaskId) => adapter.runtime.releaseAllForTask(currentTaskId),
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
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{workspaceStatusText}</p>

  {#if workspaceLookupState === 'ready' && workspacePath !== null}
    <TerminalTabsComponent
      bind:this={terminalTabsRef}
      {adapter}
      taskId={taskId}
      {workspacePath}
      {shortcutHintsVisible}
      {showShellReadyAffordance}
      onTabChange={null}
      onTabCountChange={null}
    />
  {:else if workspaceLookupState === 'loading'}
    <div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-base-content/70" role="status">
      <div class="flex flex-col items-center gap-3">
        <span class="loading loading-spinner loading-md" aria-hidden="true"></span>
        <p>{workspaceStatusText}</p>
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center p-6 text-center" role="status" aria-live="polite">
      <div class="max-w-sm space-y-3">
        <p class="font-medium">{workspaceStatusText}</p>
        {#if workspaceLookupState === 'error' && workspaceLookupError !== null}
          <p class="text-sm text-base-content/70">{workspaceLookupError}</p>
        {:else}
          <p class="text-sm text-base-content/70">{TERMINAL_TASK_PANE_WORKSPACE_RECOVERY_TEXT}</p>
        {/if}
        <p class="text-xs text-base-content/50">
          {TERMINAL_TASK_PANE_KEYBOARD_FOCUS_PATH_TEXT}
        </p>
        {#if workspaceLookupState === 'error'}
          <p class="sr-only">Terminal workspace error</p>
        {/if}
        <button type="button" class="btn btn-sm btn-primary" onclick={retryWorkspaceLookup}>Retry workspace lookup</button>
      </div>
    </div>
  {/if}
</div>
