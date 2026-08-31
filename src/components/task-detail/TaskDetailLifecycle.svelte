<script lang="ts">
  import { createTaskTerminalPaneLifecycle } from '@openforge-app/terminal-runtime'
  import { onDestroy } from 'svelte'
  import { getProjectConfig, getTaskWorkspace, writePty } from '../../lib/ipc'
  import { regularTerminalSessions } from '../../lib/terminalSessionService'
  import {
    createTaskRunAppController,
    type TaskRunAppRegistration,
    type TaskRunAppState,
  } from './taskRunAppController'

  interface Props {
    taskId: string
    projectId: string | null
    runtimeWorkspacePath: string | null
    terminalViewId: string | null
    onWorkspacePathChange: (path: string | null) => void
    onWorkspaceResolved: (taskId: string, path: string | null) => void
    onRunAppStateChange: (state: TaskRunAppState) => void
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
    onOpenTerminalView: (taskId: string, terminalViewId: string) => void
  }

  let {
    taskId,
    projectId,
    runtimeWorkspacePath,
    terminalViewId,
    onWorkspacePathChange,
    onWorkspaceResolved,
    onRunAppStateChange,
    onRunAppRegistrationChange,
    onOpenTerminalView,
  }: Props = $props()

  let workspacePath = $state<string | null>(null)

  function setWorkspacePath(path: string | null): void {
    if (workspacePath === path) return
    workspacePath = path
    onWorkspacePathChange(path)
  }

  const taskTerminalLifecycle = createTaskTerminalPaneLifecycle<string>({
    getInitialWorkspacePath: (requestedTaskId) => requestedTaskId === taskId ? runtimeWorkspacePath : null,
    getTaskWorkspace: async (requestedTaskId) => {
      try {
        const workspace = await getTaskWorkspace(requestedTaskId)
        const currentRuntimePath = requestedTaskId === taskId ? runtimeWorkspacePath : null
        return currentRuntimePath ?? workspace?.workspace_path ?? null
      } catch (lookupError) {
        const currentRuntimePath = requestedTaskId === taskId ? runtimeWorkspacePath : null
        if (currentRuntimePath !== null) return currentRuntimePath
        throw lookupError
      }
    },
    getWorkspacePath: (path) => path,
    releaseAllForTask: regularTerminalSessions.releaseAllForTask,
    setWorkspacePath,
    onWorkspaceResolved: (resolvedTaskId, path) => onWorkspaceResolved(resolvedTaskId, path),
    onWorkspaceLookupError: (requestedTaskId, lookupError) => {
      console.error(`[TaskDetailView] Failed to load workspace for ${requestedTaskId}:`, lookupError)
    },
  })

  const taskRunAppController = createTaskRunAppController({
    getProjectConfig,
    getSession: regularTerminalSessions.getTaskTerminalTabsSession,
    getShellLifecycleState: regularTerminalSessions.getShellLifecycleState,
    writePty,
    openTerminalView: (requestedTaskId, viewId) => onOpenTerminalView(requestedTaskId, viewId),
    onStateChange: (state) => onRunAppStateChange(state),
    onError: (operation, error) => {
      const description = operation === 'load-config' ? 'load run command' : 'run app command'
      console.error(`[TaskDetailView] Failed to ${description}:`, error)
    },
  })

  $effect(() => {
    taskTerminalLifecycle.syncTask(taskId)
  })

  $effect(() => {
    if (runtimeWorkspacePath !== null && runtimeWorkspacePath !== workspacePath) {
      setWorkspacePath(runtimeWorkspacePath)
    }
  })

  $effect(() => {
    taskRunAppController.sync({
      taskId,
      projectId,
      workspacePath,
      terminalViewId,
      onRegistrationChange: onRunAppRegistrationChange,
    })
  })

  onDestroy(() => {
    taskTerminalLifecycle.destroy()
    taskRunAppController.destroy()
  })
</script>
