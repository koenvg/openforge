import { isDefaultHiddenRootPath } from './fileExplorer'
import type { FileBrowserControllerState } from './fileBrowserControllerState'
import type { PendingFileRevealRequest } from './stores'
import type { FileBrowserWorkspaceIdentity } from './workspaceSource'

interface PendingFileRevealControllerOptions {
  state: FileBrowserControllerState
  getPendingReveal(): PendingFileRevealRequest | null
  clearPendingReveal(request: PendingFileRevealRequest): void
  setShowHiddenRootEntries(showHidden: boolean): void
  toggleDir(path: string): Promise<boolean>
  selectFile(path: string): Promise<boolean>
}

export function usePendingFileRevealController(options: PendingFileRevealControllerOptions) {
  let processingRequestId = $state<number | null>(null)
  let failedPath = $state<string | null>(null)
  let failedRequestId = $state<number | null>(null)
  let activeWorkspaceIdentity: FileBrowserWorkspaceIdentity | null = null
  let initialized = false
  let revealControllerRequestId = 0

  function isCurrent(
    workspaceIdentity: FileBrowserWorkspaceIdentity,
    controllerRequestId: number,
    pendingRequest: PendingFileRevealRequest,
  ): boolean {
    return options.state.getWorkspaceSource()?.identity === workspaceIdentity
      && revealControllerRequestId === controllerRequestId
      && options.getPendingReveal()?.requestId === pendingRequest.requestId
  }

  async function revealPath(pendingRequest: PendingFileRevealRequest): Promise<void> {
    const source = options.state.getWorkspaceSource()
    if (!source) return

    const { identity } = source
    const { path: targetPath, requestId } = pendingRequest
    const controllerRequestId = ++revealControllerRequestId
    processingRequestId = requestId
    failedPath = null
    failedRequestId = null

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
        if (!isCurrent(identity, controllerRequestId, pendingRequest)) return

        const workspaceState = options.state.getWorkspaceState(identity)
        if (!workspaceState.expandedPaths.has(parentPath)) {
          const expanded = await options.toggleDir(parentPath)
          if (!isCurrent(identity, controllerRequestId, pendingRequest)) return
          if (!expanded) {
            failedPath = targetPath
            failedRequestId = requestId
            return
          }
        }
      }

      const selected = await options.selectFile(targetPath)
      if (!isCurrent(identity, controllerRequestId, pendingRequest)) return
      if (selected) {
        options.clearPendingReveal(pendingRequest)
      } else {
        failedPath = targetPath
        failedRequestId = requestId
      }
    } finally {
      if (revealControllerRequestId === controllerRequestId) processingRequestId = null
    }
  }

  function retry(path: string): void {
    const pendingRequest = options.getPendingReveal()
    if (pendingRequest?.path === path) void revealPath(pendingRequest)
  }

  $effect(() => {
    const source = options.state.getWorkspaceSource()
    const workspaceIdentity = source?.identity ?? null
    const pendingReveal = options.getPendingReveal()
    const targetsCurrentWorkspace = pendingReveal !== null && (
      pendingReveal.workspaceIdentity === null
      || pendingReveal.workspaceIdentity === workspaceIdentity
    )
    const hasLoaded = source
      ? options.state.getWorkspaceState(source.identity).rootLoaded
      : false

    if (!initialized || workspaceIdentity !== activeWorkspaceIdentity) {
      initialized = true
      activeWorkspaceIdentity = workspaceIdentity
      revealControllerRequestId++
      processingRequestId = null
      failedPath = null
      failedRequestId = null
    }

    if (pendingReveal === null || !targetsCurrentWorkspace) {
      failedPath = null
      failedRequestId = null
      return
    }

    if (failedRequestId !== null && failedRequestId !== pendingReveal.requestId) {
      failedPath = null
      failedRequestId = null
    }

    if (
      hasLoaded
      && processingRequestId !== pendingReveal.requestId
      && failedRequestId !== pendingReveal.requestId
    ) {
      void revealPath(pendingReveal)
    }
  })

  return {
    get failedPath() { return failedPath },
    retry,
  }
}

export type PendingFileRevealController = ReturnType<typeof usePendingFileRevealController>
