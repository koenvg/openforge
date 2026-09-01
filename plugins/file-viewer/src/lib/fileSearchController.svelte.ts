import { onDestroy } from 'svelte'
import { buildSearchResultEntries, collectDirPaths } from './fileSearch'
import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'
import type { FileBrowserWorkspaceIdentity, FileBrowserWorkspaceSource } from './workspaceSource'

export const FILE_SEARCH_LIMIT = 50
const FILE_SEARCH_DEBOUNCE_MS = 150

export function useFileSearchController(state: FileBrowserControllerState) {
  let loading = $state(false)
  let error = $state<string | null>(null)
  let activeWorkspaceIdentity: FileBrowserWorkspaceIdentity | null = null
  let initialized = false
  let requestId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const workspaceSearchState = $derived.by(() => {
    const source = state.getWorkspaceSource()
    if (!source) {
      return { query: '', results: [] as string[] }
    }
    const workspaceState = state.getWorkspaceState(source.identity)
    return {
      query: workspaceState.searchQuery,
      results: workspaceState.searchResults,
    }
  })
  const query = $derived(workspaceSearchState.query)
  const results = $derived(workspaceSearchState.results)
  const active = $derived(query.trim().length > 0)
  const entries = $derived(buildSearchResultEntries(results))
  const expandedDirs = $derived(collectDirPaths(entries))
  const fileCount = $derived(entries.filter((entry) => !entry.isDir).length)
  const limitReached = $derived(fileCount >= FILE_SEARCH_LIMIT)

  function clearTimer(): void {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  function resetTransientState(): void {
    clearTimer()
    requestId++
    loading = false
    error = null
  }

  async function runSearch(searchQuery: string, source: FileBrowserWorkspaceSource): Promise<void> {
    const { identity } = source
    const currentRequestId = ++requestId
    loading = true
    error = null

    try {
      const nextResults = await source.searchFiles(searchQuery, FILE_SEARCH_LIMIT)
      if (currentRequestId !== requestId || state.getWorkspaceSource()?.identity !== identity) return
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        searchResults: nextResults,
        completedSearchQuery: searchQuery,
      }))
    } catch (searchError) {
      if (currentRequestId !== requestId || state.getWorkspaceSource()?.identity !== identity) return
      error = formatFileBrowserError(searchError)
      state.updateWorkspaceState(identity, (current) => ({
        ...current,
        searchResults: [],
        completedSearchQuery: null,
      }))
    } finally {
      if (currentRequestId === requestId && state.getWorkspaceSource()?.identity === identity) {
        loading = false
      }
    }
  }

  function handleInput(value: string): void {
    clearTimer()

    const source = state.getWorkspaceSource()
    const trimmedQuery = value.trim()
    if (!source) {
      resetTransientState()
      return
    }

    state.updateWorkspaceState(source.identity, (current) => ({
      ...current,
      searchQuery: value,
      searchResults: [],
      completedSearchQuery: trimmedQuery.length === 0 ? '' : null,
    }))

    if (trimmedQuery.length === 0) {
      requestId++
      loading = false
      error = null
      return
    }

    loading = true
    timer = setTimeout(() => {
      timer = null
      void runSearch(trimmedQuery, source)
    }, FILE_SEARCH_DEBOUNCE_MS)
  }

  function clear(): void {
    const source = state.getWorkspaceSource()
    if (source) {
      state.updateWorkspaceState(source.identity, (current) => ({
        ...current,
        searchQuery: '',
        searchResults: [],
        completedSearchQuery: '',
      }))
    }
    resetTransientState()
  }

  function retry(): void {
    const source = state.getWorkspaceSource()
    const trimmedQuery = query.trim()
    if (!source || trimmedQuery.length === 0) return
    void runSearch(trimmedQuery, source)
  }

  $effect(() => {
    const source = state.getWorkspaceSource()
    const workspaceIdentity = source?.identity ?? null
    if (initialized && workspaceIdentity === activeWorkspaceIdentity) return

    initialized = true
    activeWorkspaceIdentity = workspaceIdentity
    resetTransientState()

    if (!source) return
    const workspaceState = state.getWorkspaceState(source.identity)
    const trimmedQuery = workspaceState.searchQuery.trim()
    if (trimmedQuery.length > 0 && workspaceState.completedSearchQuery !== trimmedQuery) {
      void runSearch(trimmedQuery, source)
    }
  })

  onDestroy(clearTimer)

  return {
    get query() { return query },
    get active() { return active },
    get loading() { return loading },
    get error() { return error },
    get entries() { return entries },
    get expandedDirs() { return expandedDirs },
    get limitReached() { return limitReached },
    limit: FILE_SEARCH_LIMIT,
    handleInput,
    clear,
    retry,
  }
}

export type FileSearchController = ReturnType<typeof useFileSearchController>
