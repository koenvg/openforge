import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'
import type { FileBrowserWorkspaceIdentity, FileBrowserWorkspaceSource } from './workspaceSource'

export function useRootLoadingController(state: FileBrowserControllerState) {
  let loading = $state(true)
  let rootError = $state<string | null>(null)
  let directoryError = $state<{ path: string; message: string } | null>(null)
  let activeWorkspaceIdentity: FileBrowserWorkspaceIdentity | null = null
  let initialized = false
  let workspaceGeneration = 0
  let rootRequestId = 0

  function isCurrentWorkspace(workspaceIdentity: FileBrowserWorkspaceIdentity, generation: number): boolean {
    return state.getWorkspaceSource()?.identity === workspaceIdentity && workspaceGeneration === generation
  }

  async function loadRoot(source: FileBrowserWorkspaceSource): Promise<void> {
    const { identity } = source
    const generation = workspaceGeneration
    const requestId = ++rootRequestId
    loading = true
    rootError = null
    directoryError = null

    try {
      const entries = await source.readDirectory(null)
      if (!isCurrentWorkspace(identity, generation) || requestId !== rootRequestId) return
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        rootEntries: entries,
        rootLoaded: true,
      }))
    } catch (error) {
      if (isCurrentWorkspace(identity, generation) && requestId === rootRequestId) {
        rootError = formatFileBrowserError(error)
      }
    } finally {
      if (isCurrentWorkspace(identity, generation) && requestId === rootRequestId) {
        loading = false
      }
    }
  }

  async function toggleDir(path: string): Promise<boolean> {
    const source = state.getWorkspaceSource()
    if (!source) return false

    const { identity } = source
    const generation = workspaceGeneration
    const workspaceState = state.getWorkspaceState(identity)
    const nextExpanded = new Set(workspaceState.expandedPaths)

    if (nextExpanded.has(path)) {
      nextExpanded.delete(path)
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) directoryError = null
      return true
    }

    nextExpanded.add(path)
    if (workspaceState.dirContents.has(path)) {
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) directoryError = null
      return true
    }

    if (directoryError?.path === path) directoryError = null

    try {
      const entries = await source.readDirectory(path)
      if (!isCurrentWorkspace(identity, generation)) return false
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        dirContents: new Map(current.dirContents).set(path, entries),
        expandedPaths: nextExpanded,
      }))
      return true
    } catch (error) {
      if (isCurrentWorkspace(identity, generation)) {
        directoryError = { path, message: formatFileBrowserError(error) }
      }
      return false
    }
  }

  function retryRootLoad(): void {
    const source = state.getWorkspaceSource()
    if (source) void loadRoot(source)
  }

  function retryDirectoryLoad(path: string): void {
    void toggleDir(path)
  }

  function updateTreeScrollTop(scrollTop: number): void {
    const source = state.getWorkspaceSource()
    if (!source) return
    state.updateWorkspaceState(source.identity, (current) => ({
      ...current,
      treeScrollTop: scrollTop,
    }))
  }

  function setShowHiddenRootEntries(showHiddenRootEntries: boolean): void {
    const source = state.getWorkspaceSource()
    if (!source) return
    state.updateWorkspaceState(source.identity, (current) => ({
      ...current,
      showHiddenRootEntries,
    }))
  }

  function toggleHiddenRootEntries(): void {
    const source = state.getWorkspaceSource()
    if (!source) return
    const workspaceState = state.getWorkspaceState(source.identity)
    setShowHiddenRootEntries(!workspaceState.showHiddenRootEntries)
  }

  $effect(() => {
    const source = state.getWorkspaceSource()
    const workspaceIdentity = source?.identity ?? null
    if (initialized && workspaceIdentity === activeWorkspaceIdentity) return

    initialized = true
    activeWorkspaceIdentity = workspaceIdentity
    workspaceGeneration++
    rootRequestId++
    rootError = null
    directoryError = null

    if (!source) {
      loading = false
      return
    }

    if (state.getWorkspaceState(source.identity).rootLoaded) {
      loading = false
    } else {
      void loadRoot(source)
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
