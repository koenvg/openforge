import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'

export function useFileSelectionController(state: FileBrowserControllerState) {
  let fileError = $state<string | null>(null)
  let previewFocusRequest = $state<number | null>(null)
  let treeFocusRequest = $state<number | null>(null)
  let activeProjectId: string | null = null
  let initialized = false
  let fileRequestId = 0

  async function selectFile(path: string): Promise<boolean> {
    const projectId = state.getProjectId()
    if (!projectId) return false

    const requestId = ++fileRequestId
    state.updateProjectState(projectId, (current) => ({
      ...current,
      selectedPath: path,
      fileContent: null,
      contentScrollTop: 0,
    }))
    previewFocusRequest = (previewFocusRequest ?? 0) + 1
    fileError = null

    try {
      const fileContent = await state.api.fs.readFile({ projectId, path })
      const currentState = state.getProjectState(projectId)
      if (
        requestId !== fileRequestId
        || state.getProjectId() !== projectId
        || currentState.selectedPath !== path
      ) return false

      state.updateProjectState(projectId, (current) => ({
        ...current,
        fileContent,
      }))
      return true
    } catch (error) {
      const currentState = state.getProjectState(projectId)
      if (
        requestId !== fileRequestId
        || state.getProjectId() !== projectId
        || currentState.selectedPath !== path
      ) return false

      fileError = formatFileBrowserError(error)
      return true
    }
  }

  function retrySelectedFile(): void {
    const projectId = state.getProjectId()
    if (!projectId) return
    const path = state.getProjectState(projectId).selectedPath
    if (path) void selectFile(path)
  }

  function updateContentScrollTop(contentScrollTop: number): void {
    const projectId = state.getProjectId()
    if (!projectId) return
    state.updateProjectState(projectId, (current) => ({
      ...current,
      contentScrollTop,
    }))
  }

  function returnFocusToSelectedFile(): void {
    treeFocusRequest = (treeFocusRequest ?? 0) + 1
  }

  $effect(() => {
    const projectId = state.getProjectId()
    if (initialized && projectId === activeProjectId) return

    initialized = true
    activeProjectId = projectId
    fileRequestId++
    fileError = null

    if (!projectId) return
    const projectState = state.getProjectState(projectId)
    if (
      projectState.rootLoaded
      && projectState.selectedPath !== null
      && projectState.fileContent === null
    ) {
      void selectFile(projectState.selectedPath)
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
