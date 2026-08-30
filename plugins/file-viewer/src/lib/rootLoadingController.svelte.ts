import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'

export function useRootLoadingController(state: FileBrowserControllerState) {
  let loading = $state(true)
  let rootError = $state<string | null>(null)
  let directoryError = $state<{ path: string; message: string } | null>(null)
  let activeProjectId: string | null = null
  let initialized = false
  let projectGeneration = 0
  let rootRequestId = 0

  function isCurrentProject(projectId: string, generation: number): boolean {
    return state.getProjectId() === projectId && projectGeneration === generation
  }

  async function loadRoot(projectId: string): Promise<void> {
    const generation = projectGeneration
    const requestId = ++rootRequestId
    loading = true
    rootError = null
    directoryError = null

    try {
      const entries = await state.api.fs.readDir({ projectId, path: null })
      if (!isCurrentProject(projectId, generation) || requestId !== rootRequestId) return
      state.updateProjectState(projectId, (current) => ({
        ...current,
        rootEntries: entries,
        rootLoaded: true,
      }))
    } catch (error) {
      if (isCurrentProject(projectId, generation) && requestId === rootRequestId) {
        rootError = formatFileBrowserError(error)
      }
    } finally {
      if (isCurrentProject(projectId, generation) && requestId === rootRequestId) {
        loading = false
      }
    }
  }

  async function toggleDir(path: string): Promise<boolean> {
    const projectId = state.getProjectId()
    if (!projectId) return false

    const generation = projectGeneration
    const projectState = state.getProjectState(projectId)
    const nextExpanded = new Set(projectState.expandedPaths)

    if (nextExpanded.has(path)) {
      nextExpanded.delete(path)
      state.updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) directoryError = null
      return true
    }

    nextExpanded.add(path)
    if (projectState.dirContents.has(path)) {
      state.updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) directoryError = null
      return true
    }

    if (directoryError?.path === path) directoryError = null

    try {
      const entries = await state.api.fs.readDir({ projectId, path })
      if (!isCurrentProject(projectId, generation)) return false
      state.updateProjectState(projectId, (current) => ({
        ...current,
        dirContents: new Map(current.dirContents).set(path, entries),
        expandedPaths: nextExpanded,
      }))
      return true
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        directoryError = { path, message: formatFileBrowserError(error) }
      }
      return false
    }
  }

  function retryRootLoad(): void {
    const projectId = state.getProjectId()
    if (projectId) void loadRoot(projectId)
  }

  function retryDirectoryLoad(path: string): void {
    void toggleDir(path)
  }

  function updateTreeScrollTop(scrollTop: number): void {
    const projectId = state.getProjectId()
    if (!projectId) return
    state.updateProjectState(projectId, (current) => ({
      ...current,
      treeScrollTop: scrollTop,
    }))
  }

  function setShowHiddenRootEntries(showHiddenRootEntries: boolean): void {
    const projectId = state.getProjectId()
    if (!projectId) return
    state.updateProjectState(projectId, (current) => ({
      ...current,
      showHiddenRootEntries,
    }))
  }

  function toggleHiddenRootEntries(): void {
    const projectId = state.getProjectId()
    if (!projectId) return
    const projectState = state.getProjectState(projectId)
    setShowHiddenRootEntries(!projectState.showHiddenRootEntries)
  }

  $effect(() => {
    const projectId = state.getProjectId()
    if (initialized && projectId === activeProjectId) return

    initialized = true
    activeProjectId = projectId
    projectGeneration++
    rootRequestId++
    rootError = null
    directoryError = null

    if (!projectId) {
      loading = false
      return
    }

    if (state.getProjectState(projectId).rootLoaded) {
      loading = false
    } else {
      void loadRoot(projectId)
    }
  })

  return {
    get loading() { return loading },
    get rootError() { return rootError },
    get directoryError() { return directoryError },
    retryRootLoad,
    retryDirectoryLoad,
    toggleDir,
    updateTreeScrollTop,
    setShowHiddenRootEntries,
    toggleHiddenRootEntries,
  }
}

export type RootLoadingController = ReturnType<typeof useRootLoadingController>
