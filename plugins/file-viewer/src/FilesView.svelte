<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import { activeProjectId, fileBrowserStates, pendingFileReveal } from './lib/stores'
  import {
    countDefaultHiddenRootEntries,
    createEmptyFileBrowserProjectState,
    flattenFileBrowserEntries,
    getFileBrowserProjectState,
    isDefaultHiddenRootPath,
    updateFileBrowserProjectState,
    type FileBrowserProjectState,
  } from './lib/fileExplorer'
  import { buildSearchResultEntries, collectDirPaths } from './lib/fileSearch'
  import FilesBrowserSection from './FilesBrowserSection.svelte'

  const SEARCH_LIMIT = 50
  const SEARCH_DEBOUNCE_MS = 150

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string | null
  }

  let { api, context: _context, projectId = null }: Props = $props()

  let loading = $state(true)
  let rootError = $state<string | null>(null)
  let directoryError = $state<{ path: string; message: string } | null>(null)
  let fileError = $state<string | null>(null)
  let loadedProjectId = $state<string | null>(null)
  let processingRevealPath = $state<string | null>(null)
  let failedRevealPath = $state<string | null>(null)
  let previewFocusRequest = $state<number | null>(null)
  let treeFocusRequest = $state<number | null>(null)
  let activeFileRequestId = 0

  let searchQuery = $state('')
  let searchResults = $state<string[]>([])
  let searchLoading = $state(false)
  let searchError = $state<string | null>(null)
  let searchRequestId = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const projectState = $derived.by((): FileBrowserProjectState => {
    const currentProjectId = $activeProjectId
    return currentProjectId ? getFileBrowserProjectState($fileBrowserStates, currentProjectId) : createEmptyFileBrowserProjectState()
  })
  const hasLoaded = $derived(projectState.rootLoaded)
  const rootEntries = $derived(projectState.rootEntries)
  const expandedPaths = $derived(projectState.expandedPaths)
  const selectedPath = $derived(projectState.selectedPath)
  const fileContent = $derived(projectState.fileContent)
  const showHiddenRootEntries = $derived(projectState.showHiddenRootEntries)
  const hiddenRootEntryCount = $derived(countDefaultHiddenRootEntries(rootEntries))
  const flatEntries = $derived(flattenFileBrowserEntries(projectState))
  const selectedEntry = $derived(
    selectedPath ? flatEntries.find((entry) => entry.path === selectedPath) ?? null : null
  )
  const selectedFileName = $derived(
    selectedPath ? selectedPath.split('/').at(-1) ?? selectedPath : ''
  )

  const searchActive = $derived(searchQuery.trim().length > 0)
  const searchEntries = $derived(buildSearchResultEntries(searchResults))
  const searchExpandedDirs = $derived(collectDirPaths(searchEntries))
  const searchFileCount = $derived(searchEntries.filter((entry) => !entry.isDir).length)
  const searchLimitReached = $derived(searchFileCount >= SEARCH_LIMIT)

  function updateProjectState(
    projectId: string,
    updater: (state: FileBrowserProjectState) => FileBrowserProjectState,
  ) {
    fileBrowserStates.update((states) => updateFileBrowserProjectState(states, projectId, updater))
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function loadRoot(projectId: string) {
    loading = true
    rootError = null
    directoryError = null
    try {
      const entries = await api.fs.readDir({ projectId, path: null })
      if ($activeProjectId !== projectId) return
      updateProjectState(projectId, (state) => ({
        ...state,
        rootEntries: entries,
        rootLoaded: true,
      }))
    } catch (e) {
      if ($activeProjectId === projectId) {
        rootError = formatError(e)
      }
    } finally {
      if ($activeProjectId === projectId) {
        loading = false
      }
    }
  }

  async function toggleDir(path: string): Promise<boolean> {
    const projectId = $activeProjectId
    if (!projectId) return false

    const state = getFileBrowserProjectState($fileBrowserStates, projectId)
    const nextExpanded = new Set(state.expandedPaths)

    if (nextExpanded.has(path)) {
      nextExpanded.delete(path)
      updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) {
        directoryError = null
      }
      return true
    }

    nextExpanded.add(path)
    if (state.dirContents.has(path)) {
      updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      if (directoryError?.path === path) {
        directoryError = null
      }
      return true
    }

    if (directoryError?.path === path) {
      directoryError = null
    }

    try {
      const entries = await api.fs.readDir({ projectId, path })
      if ($activeProjectId !== projectId) return false
      updateProjectState(projectId, (current) => ({
        ...current,
        dirContents: new Map(current.dirContents).set(path, entries),
        expandedPaths: nextExpanded,
      }))
      return true
    } catch (e) {
      if ($activeProjectId === projectId) {
        directoryError = { path, message: formatError(e) }
      }
      return false
    }
  }

  async function selectFile(path: string): Promise<boolean> {
    const projectId = $activeProjectId
    if (!projectId) return false

    const requestId = ++activeFileRequestId
    updateProjectState(projectId, (state) => ({
      ...state,
      selectedPath: path,
      fileContent: null,
      contentScrollTop: 0,
    }))
    previewFocusRequest = (previewFocusRequest ?? 0) + 1
    fileError = null

    try {
      const nextContent = await api.fs.readFile({ projectId, path })
      const currentState = getFileBrowserProjectState($fileBrowserStates, projectId)
      if (requestId !== activeFileRequestId || $activeProjectId !== projectId || currentState.selectedPath !== path) return false
      updateProjectState(projectId, (state) => ({
        ...state,
        fileContent: nextContent,
      }))
      return true
    } catch (e) {
      const currentState = getFileBrowserProjectState($fileBrowserStates, projectId)
      if (requestId !== activeFileRequestId || $activeProjectId !== projectId || currentState.selectedPath !== path) return false
      fileError = formatError(e)
      return true
    }
  }

  function retryRootLoad() {
    const projectId = $activeProjectId
    if (!projectId) return
    void loadRoot(projectId)
  }

  function retryDirectoryLoad(path: string) {
    void toggleDir(path)
  }

  function retrySelectedFile() {
    const path = selectedPath
    if (!path) return
    void selectFile(path)
  }

  function resetSearch() {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    searchRequestId++
    searchQuery = ''
    searchResults = []
    searchLoading = false
    searchError = null
  }

  async function runSearch(query: string, projectId: string) {
    const requestId = ++searchRequestId
    searchLoading = true
    searchError = null
    try {
      const results = await api.fs.searchFiles({ projectId, query, limit: SEARCH_LIMIT })
      if (requestId !== searchRequestId || $activeProjectId !== projectId) return
      searchResults = results
    } catch (e) {
      if (requestId !== searchRequestId || $activeProjectId !== projectId) return
      searchError = formatError(e)
      searchResults = []
    } finally {
      if (requestId === searchRequestId && $activeProjectId === projectId) {
        searchLoading = false
      }
    }
  }

  function handleSearchInput(value: string) {
    searchQuery = value
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }

    const projectId = $activeProjectId
    const trimmed = value.trim()
    if (!projectId || trimmed.length === 0) {
      searchRequestId++
      searchResults = []
      searchLoading = false
      searchError = null
      return
    }

    searchLoading = true
    searchTimer = setTimeout(() => {
      searchTimer = null
      void runSearch(trimmed, projectId)
    }, SEARCH_DEBOUNCE_MS)
  }

  function clearSearch() {
    resetSearch()
  }

  function retrySearch() {
    const projectId = $activeProjectId
    const trimmed = searchQuery.trim()
    if (!projectId || trimmed.length === 0) return
    void runSearch(trimmed, projectId)
  }

  function retryRevealPath(path: string) {
    void revealPath(path)
  }

  function updateTreeScrollTop(scrollTop: number) {
    const projectId = $activeProjectId
    if (!projectId) return
    updateProjectState(projectId, (state) => ({
      ...state,
      treeScrollTop: scrollTop,
    }))
  }

  function updateContentScrollTop(scrollTop: number) {
    const projectId = $activeProjectId
    if (!projectId) return
    updateProjectState(projectId, (state) => ({
      ...state,
      contentScrollTop: scrollTop,
    }))
  }

  function setShowHiddenRootEntries(showHidden: boolean) {
    const projectId = $activeProjectId
    if (!projectId) return
    updateProjectState(projectId, (state) => ({
      ...state,
      showHiddenRootEntries: showHidden,
    }))
  }

  function toggleHiddenRootEntries() {
    setShowHiddenRootEntries(!showHiddenRootEntries)
  }

  function returnFocusToSelectedFile() {
    treeFocusRequest = (treeFocusRequest ?? 0) + 1
  }

  async function revealPath(targetPath: string) {
    const revealProjectId = $activeProjectId
    if (!revealProjectId) return

    processingRevealPath = targetPath
    failedRevealPath = null
    if (isDefaultHiddenRootPath(targetPath)) {
      setShowHiddenRootEntries(true)
    }
    try {
      const parts = targetPath.split('/')
      const parentPaths: string[] = []
      for (let i = 1; i < parts.length; i++) {
        parentPaths.push(parts.slice(0, i).join('/'))
      }
      for (const parent of parentPaths) {
        if ($activeProjectId !== revealProjectId) {
          failedRevealPath = targetPath
          return
        }

        const currentState = getFileBrowserProjectState($fileBrowserStates, revealProjectId)
        if (!currentState.expandedPaths.has(parent)) {
          const expanded = await toggleDir(parent)
          if (!expanded || $activeProjectId !== revealProjectId) {
            failedRevealPath = targetPath
            return
          }
        }
      }

      const selected = await selectFile(targetPath)
      if (selected && $activeProjectId === revealProjectId) {
        $pendingFileReveal = null
      } else {
        failedRevealPath = targetPath
      }
    } finally {
      processingRevealPath = null
    }
  }

  $effect(() => {
    $activeProjectId = projectId
  })

  $effect(() => {
    const currentProjectId = $activeProjectId
    if (currentProjectId === loadedProjectId) return

    loadedProjectId = currentProjectId
    activeFileRequestId++
    rootError = null
    directoryError = null
    fileError = null
    resetSearch()

    if (!currentProjectId) {
      loading = false
      return
    }

    const state = getFileBrowserProjectState($fileBrowserStates, currentProjectId)
    if (state.rootLoaded) {
      loading = false
      if (state.selectedPath !== null && state.fileContent === null) {
        void selectFile(state.selectedPath)
      }
    } else {
      void loadRoot(currentProjectId)
    }
  })

  $effect(() => {
    const path = $pendingFileReveal
    if (path === null) {
      failedRevealPath = null
      return
    }

    if (failedRevealPath !== null && failedRevealPath !== path) {
      failedRevealPath = null
    }

    if (hasLoaded && processingRevealPath !== path && failedRevealPath !== path) {
      void revealPath(path)
    }
  })

  onDestroy(() => {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  })
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">

  <FilesBrowserSection
    {api}
    activeProjectId={$activeProjectId}
    {loading}
    {rootError}
    {directoryError}
    {fileError}
    {failedRevealPath}
    {rootEntries}
    {flatEntries}
    {expandedPaths}
    {selectedPath}
    {selectedEntry}
    {selectedFileName}
    {projectState}
    {fileContent}
    {previewFocusRequest}
    {treeFocusRequest}
    {hiddenRootEntryCount}
    {showHiddenRootEntries}
    {searchQuery}
    {searchActive}
    {searchLoading}
    {searchError}
    {searchEntries}
    {searchExpandedDirs}
    {searchLimitReached}
    searchLimit={SEARCH_LIMIT}
    onSearchInput={handleSearchInput}
    onClearSearch={clearSearch}
    onToggleHiddenRootEntries={toggleHiddenRootEntries}
    onRetrySearch={retrySearch}
    onRetryRootLoad={retryRootLoad}
    onRetryDirectoryLoad={retryDirectoryLoad}
    onRetrySelectedFile={retrySelectedFile}
    onRetryRevealPath={retryRevealPath}
    onToggleDir={toggleDir}
    onSelectFile={selectFile}
    onTreeScrollTopChange={updateTreeScrollTop}
    onContentScrollTopChange={updateContentScrollTop}
    onReturnFocusToSelectedFile={returnFocusToSelectedFile}
  />
</div>
