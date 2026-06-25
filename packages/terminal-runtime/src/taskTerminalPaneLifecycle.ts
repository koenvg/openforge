export interface TerminalTaskPaneController {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabIndex: number): void
}

export interface TaskTerminalPaneLifecycleOptions<TWorkspace> {
  controller?: TerminalTaskPaneController
  getTaskWorkspace(taskId: string): Promise<TWorkspace | null>
  getWorkspacePath(workspace: TWorkspace | null): string | null
  getInitialWorkspacePath?: (taskId: string) => string | null
  registerController?: (taskId: string, controller: TerminalTaskPaneController) => void
  unregisterController?: (taskId: string, controller: TerminalTaskPaneController) => void
  releaseAllForTask(taskId: string): void
  setWorkspacePath(path: string | null): void
  onWorkspaceLoading?: (taskId: string, initialPath: string | null) => void
  onWorkspaceResolved?: (taskId: string, path: string | null) => void
  onWorkspaceLookupError?: (taskId: string, error: unknown) => void
}

export interface TaskTerminalPaneLifecycle {
  syncTask(taskId: string): void
  retryWorkspaceLookup(): void
  destroy(): void
}

export function createTaskTerminalPaneLifecycle<TWorkspace>(
  options: TaskTerminalPaneLifecycleOptions<TWorkspace>,
): TaskTerminalPaneLifecycle {
  let currentTaskId: string | null = null
  let workspaceLookupToken = 0
  let destroyed = false

  function cleanupTask(taskId: string): void {
    if (options.controller) {
      options.unregisterController?.(taskId, options.controller)
    }
    options.releaseAllForTask(taskId)
  }

  function isCurrentLookup(taskId: string, token: number): boolean {
    return !destroyed && currentTaskId === taskId && workspaceLookupToken === token
  }

  function startWorkspaceLookup(taskId: string): void {
    const initialPath = options.getInitialWorkspacePath?.(taskId) ?? null
    options.setWorkspacePath(initialPath)
    options.onWorkspaceLoading?.(taskId, initialPath)

    const lookupToken = ++workspaceLookupToken
    void options.getTaskWorkspace(taskId)
      .then((workspace) => {
        if (!isCurrentLookup(taskId, lookupToken)) return
        const workspacePath = options.getWorkspacePath(workspace)
        options.setWorkspacePath(workspacePath)
        options.onWorkspaceResolved?.(taskId, workspacePath)
      })
      .catch((error: unknown) => {
        if (!isCurrentLookup(taskId, lookupToken)) return
        options.onWorkspaceLookupError?.(taskId, error)
        options.setWorkspacePath(null)
      })
  }

  function syncTask(taskId: string): void {
    if (destroyed || taskId === currentTaskId) return

    if (currentTaskId !== null) {
      cleanupTask(currentTaskId)
    }

    currentTaskId = taskId
    if (options.controller) {
      options.registerController?.(taskId, options.controller)
    }

    startWorkspaceLookup(taskId)
  }

  function retryWorkspaceLookup(): void {
    if (destroyed || currentTaskId === null) return
    startWorkspaceLookup(currentTaskId)
  }

  function destroy(): void {
    if (destroyed) return

    destroyed = true
    workspaceLookupToken += 1

    if (currentTaskId !== null) {
      cleanupTask(currentTaskId)
      currentTaskId = null
    }
  }

  return { syncTask, retryWorkspaceLookup, destroy }
}
