export type TerminalTaskPaneWorkspaceLookupState = 'loading' | 'ready' | 'unavailable' | 'error'

export interface TerminalTaskPaneWorkspaceResult {
  workspace_path?: string | null
}

export interface TerminalTaskPaneWorkspaceSnapshot {
  workspacePath: string | null
  workspaceLookupState: TerminalTaskPaneWorkspaceLookupState
  workspaceLookupError: string | null
}

export interface TerminalTaskPaneWorkspaceLookupRequest {
  taskId: string
  token: number
}

export interface TerminalTaskPaneTaskSwitch {
  changed: boolean
  previousTaskId: string | null
  taskId: string
}

export function getTerminalTaskPaneWorkspaceStatusText(state: TerminalTaskPaneWorkspaceLookupState): string {
  if (state === 'loading') return 'Loading terminal workspace…'
  if (state === 'unavailable') return 'Terminal workspace unavailable for this task.'
  if (state === 'error') return 'Terminal workspace lookup failed.'
  return 'Terminal workspace ready.'
}

export function formatTerminalTaskPaneWorkspaceLookupError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Unable to resolve the workspace for this task.'
}

export function createLoadingTerminalTaskPaneWorkspaceSnapshot(): TerminalTaskPaneWorkspaceSnapshot {
  return {
    workspacePath: null,
    workspaceLookupState: 'loading',
    workspaceLookupError: null,
  }
}

export function createResolvedTerminalTaskPaneWorkspaceSnapshot(
  workspace: TerminalTaskPaneWorkspaceResult | null | undefined,
): TerminalTaskPaneWorkspaceSnapshot {
  const workspacePath = workspace?.workspace_path ?? null

  return {
    workspacePath,
    workspaceLookupState: workspacePath === null ? 'unavailable' : 'ready',
    workspaceLookupError: null,
  }
}

export function createRejectedTerminalTaskPaneWorkspaceSnapshot(error: unknown): TerminalTaskPaneWorkspaceSnapshot {
  return {
    workspacePath: null,
    workspaceLookupState: 'error',
    workspaceLookupError: formatTerminalTaskPaneWorkspaceLookupError(error),
  }
}

export interface TerminalTaskPaneWorkspaceLookupController {
  getActiveTaskId(): string | null
  switchTask(taskId: string): TerminalTaskPaneTaskSwitch
  startLookup(taskId: string): TerminalTaskPaneWorkspaceLookupRequest
  resolveLookup(
    request: TerminalTaskPaneWorkspaceLookupRequest,
    workspace: TerminalTaskPaneWorkspaceResult | null | undefined,
  ): TerminalTaskPaneWorkspaceSnapshot | null
  rejectLookup(request: TerminalTaskPaneWorkspaceLookupRequest, error: unknown): TerminalTaskPaneWorkspaceSnapshot | null
  cancelLookups(): void
  clearTask(): void
}

export function createTerminalTaskPaneWorkspaceLookupController(): TerminalTaskPaneWorkspaceLookupController {
  let activeTaskId: string | null = null
  let lookupToken = 0

  function isCurrentLookup(request: TerminalTaskPaneWorkspaceLookupRequest): boolean {
    return request.token === lookupToken && activeTaskId === request.taskId
  }

  return {
    getActiveTaskId() {
      return activeTaskId
    },
    switchTask(taskId) {
      const previousTaskId = activeTaskId
      if (taskId === previousTaskId) {
        return { changed: false, previousTaskId, taskId }
      }

      activeTaskId = taskId
      return { changed: true, previousTaskId, taskId }
    },
    startLookup(taskId) {
      lookupToken += 1
      return { taskId, token: lookupToken }
    },
    resolveLookup(request, workspace) {
      if (!isCurrentLookup(request)) return null
      return createResolvedTerminalTaskPaneWorkspaceSnapshot(workspace)
    },
    rejectLookup(request, error) {
      if (!isCurrentLookup(request)) return null
      return createRejectedTerminalTaskPaneWorkspaceSnapshot(error)
    },
    cancelLookups() {
      lookupToken += 1
    },
    clearTask() {
      activeTaskId = null
    },
  }
}
