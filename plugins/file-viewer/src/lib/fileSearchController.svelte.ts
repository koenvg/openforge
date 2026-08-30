import { onDestroy } from 'svelte'
import { buildSearchResultEntries, collectDirPaths } from './fileSearch'
import type { FileBrowserControllerState } from './fileBrowserControllerState'
import { formatFileBrowserError } from './fileBrowserControllerState'

export const FILE_SEARCH_LIMIT = 50
const FILE_SEARCH_DEBOUNCE_MS = 150

export function useFileSearchController(state: FileBrowserControllerState) {
  let query = $state('')
  let results = $state<string[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let activeProjectId: string | null = null
  let initialized = false
  let requestId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

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

  function reset(): void {
    clearTimer()
    requestId++
    query = ''
    results = []
    loading = false
    error = null
  }

  async function runSearch(searchQuery: string, projectId: string): Promise<void> {
    const currentRequestId = ++requestId
    loading = true
    error = null

    try {
      const nextResults = await state.api.fs.searchFiles({
        projectId,
        query: searchQuery,
        limit: FILE_SEARCH_LIMIT,
      })
      if (currentRequestId !== requestId || state.getProjectId() !== projectId) return
      results = nextResults
    } catch (searchError) {
      if (currentRequestId !== requestId || state.getProjectId() !== projectId) return
      error = formatFileBrowserError(searchError)
      results = []
    } finally {
      if (currentRequestId === requestId && state.getProjectId() === projectId) {
        loading = false
      }
    }
  }

  function handleInput(value: string): void {
    query = value
    clearTimer()

    const projectId = state.getProjectId()
    const trimmedQuery = value.trim()
    if (!projectId || trimmedQuery.length === 0) {
      requestId++
      results = []
      loading = false
      error = null
      return
    }

    loading = true
    timer = setTimeout(() => {
      timer = null
      void runSearch(trimmedQuery, projectId)
    }, FILE_SEARCH_DEBOUNCE_MS)
  }

  function retry(): void {
    const projectId = state.getProjectId()
    const trimmedQuery = query.trim()
    if (!projectId || trimmedQuery.length === 0) return
    void runSearch(trimmedQuery, projectId)
  }

  $effect(() => {
    const projectId = state.getProjectId()
    if (initialized && projectId === activeProjectId) return
    initialized = true
    activeProjectId = projectId
    reset()
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
    clear: reset,
    retry,
  }
}

export type FileSearchController = ReturnType<typeof useFileSearchController>
