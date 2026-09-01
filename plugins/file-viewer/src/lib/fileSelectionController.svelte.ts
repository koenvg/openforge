import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'
import type { FileBrowserWorkspaceIdentity } from './workspaceSource'

export function useFileSelectionController(state: FileBrowserControllerState) {
  let fileError = $state<string | null>(null)
  let previewFocusRequest = $state<number | null>(null)
  let treeFocusRequest = $state<number | null>(null)
  let activeWorkspaceIdentity: FileBrowserWorkspaceIdentity | null = null
  let initialized = false
  let fileRequestId = 0

  async function selectFile(path: string, suffix = ''): Promise<boolean> {
    const source = state.getWorkspaceSource()
    if (!source) return false

    const { identity } = source
    const requestId = ++fileRequestId
    state.updateWorkspaceState(identity, (current) => ({
      ...current,
      selectedPath: path,
      selectedSuffix: suffix,
      fileContent: null,
      contentScrollTop: 0,
    }))
    previewFocusRequest = (previewFocusRequest ?? 0) + 1
    fileError = null

    try {
      const fileContent = await source.readFile(path)
      const currentState = state.getWorkspaceState(identity)
      if (
        requestId !== fileRequestId
        || state.getWorkspaceSource()?.identity !== identity
        || currentState.selectedPath !== path
      ) return false

      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        fileContent,
      }))
      return true
    } catch (error) {
      const currentState = state.getWorkspaceState(identity)
      if (
        requestId !== fileRequestId
        || state.getWorkspaceSource()?.identity !== identity
        || currentState.selectedPath !== path
      ) return false

      fileError = formatFileBrowserError(error)
      return true
    }
  }

  function retrySelectedFile(): void {
    const source = state.getWorkspaceSource()
    if (!source) return
    const workspaceState = state.getWorkspaceState(source.identity)
    if (workspaceState.selectedPath) {
      void selectFile(workspaceState.selectedPath, workspaceState.selectedSuffix)
    }
  }

  function updateContentScrollTop(contentScrollTop: number): void {
    const source = state.getWorkspaceSource()
    if (!source) return
    state.updateWorkspaceState(source.identity, (current) => ({
      ...current,
      contentScrollTop,
    }))
  }

  function returnFocusToSelectedFile(): void {
    treeFocusRequest = (treeFocusRequest ?? 0) + 1
  }

  $effect(() => {
    const source = state.getWorkspaceSource()
    const workspaceIdentity = source?.identity ?? null
    if (initialized && workspaceIdentity === activeWorkspaceIdentity) return

    initialized = true
    activeWorkspaceIdentity = workspaceIdentity
    fileRequestId++
    fileError = null

    if (!source) return
    const workspaceState = state.getWorkspaceState(source.identity)
    if (
      workspaceState.rootLoaded
      && workspaceState.selectedPath !== null
      && workspaceState.fileContent === null
    ) {
      void selectFile(workspaceState.selectedPath, workspaceState.selectedSuffix)
    }
  })

  return {
    get fileError() { return fileError },
    get previewFocusRequest() { return previewFocusRequest },
    get treeFocusRequest() { return treeFocusRequest },
    selectFile,
    retrySelectedFile,
    updateContentScrollTop,
    returnFocusToSelectedFile,
  }
}

export type FileSelectionController = ReturnType<typeof useFileSelectionController>
