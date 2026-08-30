import { isDefaultHiddenRootPath } from './fileExplorer'
import type { FileBrowserControllerState } from './fileBrowserControllerState'

interface PendingFileRevealControllerOptions {
  state: FileBrowserControllerState
  getPendingPath(): string | null
  clearPendingPath(): void
  setShowHiddenRootEntries(showHidden: boolean): void
  toggleDir(path: string): Promise<boolean>
  selectFile(path: string): Promise<boolean>
}

export function usePendingFileRevealController(options: PendingFileRevealControllerOptions) {
  let processingPath = $state<string | null>(null)
  let failedPath = $state<string | null>(null)
  let activeProjectId: string | null = null
  let initialized = false
  let revealRequestId = 0

  function isCurrent(projectId: string, requestId: number): boolean {
    return options.state.getProjectId() === projectId && revealRequestId === requestId
  }

  async function revealPath(targetPath: string): Promise<void> {
    const projectId = options.state.getProjectId()
    if (!projectId) return

    const requestId = ++revealRequestId
    processingPath = targetPath
    failedPath = null

    if (isDefaultHiddenRootPath(targetPath)) {
      options.setShowHiddenRootEntries(true)
    }

    try {
      const parts = targetPath.split('/')
      const parentPaths: string[] = []
      for (let index = 1; index < parts.length; index++) {
        parentPaths.push(parts.slice(0, index).join('/'))
      }

      for (const parentPath of parentPaths) {
        if (!isCurrent(projectId, requestId)) return

        const projectState = options.state.getProjectState(projectId)
        if (!projectState.expandedPaths.has(parentPath)) {
          const expanded = await options.toggleDir(parentPath)
          if (!isCurrent(projectId, requestId)) return
          if (!expanded) {
            failedPath = targetPath
            return
          }
        }
      }

      const selected = await options.selectFile(targetPath)
      if (!isCurrent(projectId, requestId)) return
      if (selected) {
        options.clearPendingPath()
      } else {
        failedPath = targetPath
      }
    } finally {
      if (revealRequestId === requestId) processingPath = null
    }
  }

  function retry(path: string): void {
    void revealPath(path)
  }

  $effect(() => {
    const projectId = options.state.getProjectId()
    const pendingPath = options.getPendingPath()
    const hasLoaded = projectId
      ? options.state.getProjectState(projectId).rootLoaded
      : false

    if (!initialized || projectId !== activeProjectId) {
      initialized = true
      activeProjectId = projectId
      revealRequestId++
      processingPath = null
      failedPath = null
    }

    if (pendingPath === null) {
      failedPath = null
      return
    }

    if (failedPath !== null && failedPath !== pendingPath) {
      failedPath = null
    }

    if (hasLoaded && processingPath !== pendingPath && failedPath !== pendingPath) {
      void revealPath(pendingPath)
    }
  })

  return {
    get failedPath() { return failedPath },
    retry,
  }
}

export type PendingFileRevealController = ReturnType<typeof usePendingFileRevealController>
