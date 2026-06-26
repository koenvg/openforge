<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
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
  import ProjectFileTree from './ProjectFileTree.svelte'
  import FileContentViewer from './FileContentViewer.svelte'
  import ResizablePanel from '@openforge/plugin-sdk/ui/ResizablePanel.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  let loading = $state(true)
  let rootError = $state<string | null>(null)
  let directoryError = $state<{ path: string; message: string } | null>(null)
  let fileError = $state<string | null>(null)
  let loadedProjectId = $state<string | null>(null)
  let processingRevealPath = $state<string | null>(null)
  let failedRevealPath = $state<string | null>(null)
  let activeFileRequestId = 0

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
  const visibleRootEntryCount = $derived(showHiddenRootEntries ? rootEntries.length : rootEntries.length - hiddenRootEntryCount)
  const flatEntries = $derived(flattenFileBrowserEntries(projectState))
  const selectedEntry = $derived(
    selectedPath ? flatEntries.find((entry) => entry.path === selectedPath) ?? null : null
  )
  const selectedFileName = $derived(
    selectedPath ? selectedPath.split('/').at(-1) ?? selectedPath : ''
  )

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
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <div class="flex items-center justify-between gap-3 px-4 py-2 border-b border-base-300 shrink-0 bg-base-200">
    <h2 class="text-sm font-semibold text-base-content min-w-0 truncate">{projectName} — Files</h2>
    {#if hasLoaded && !loading}
      <div class="flex items-center gap-2 shrink-0">
        {#if hiddenRootEntryCount > 0}
          <button
            class="btn btn-ghost btn-xs"
            type="button"
            onclick={toggleHiddenRootEntries}
            aria-pressed={showHiddenRootEntries}
          >
            {showHiddenRootEntries ? 'Hide generated folders' : `Show generated folders (${hiddenRootEntryCount})`}
          </button>
        {/if}
        <span class="badge badge-neutral badge-sm">{visibleRootEntryCount} {visibleRootEntryCount === 1 ? 'item' : 'items'}</span>
      </div>
    {/if}
  </div>

  <div class="flex flex-1 min-h-0 overflow-hidden">
    {#if !$activeProjectId}
      <div class="flex-1 flex items-center justify-center text-base-content/50 text-sm p-6 text-center">
        Select a project to browse files
      </div>
    {:else if loading}
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="flex flex-col items-center gap-3 text-center">
          <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
          <p class="text-sm text-base-content/70">Loading project files…</p>
        </div>
      </div>
    {:else if rootError !== null && rootEntries.length === 0}
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="text-center space-y-3 max-w-sm">
          <div class="space-y-2">
            <h3 class="text-base font-semibold">Failed to load files</h3>
            <p class="text-sm text-error">{rootError}</p>
          </div>
          <button class="btn btn-sm btn-outline" type="button" onclick={retryRootLoad}>
            Retry loading project files
          </button>
        </div>
      </div>
    {:else}
      <ResizablePanel storageKey="files-tree" defaultWidth={240} side="left">
        <div class="flex h-full min-h-0 flex-col">
          {#if directoryError !== null}
            <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
              <div class="space-y-2">
                <div>
                  <p class="font-medium text-base-content break-all">Unable to load directory {directoryError.path}</p>
                  <p class="mt-1 text-error break-words">{directoryError.message}</p>
                </div>
                <button class="btn btn-xs btn-outline" type="button" onclick={() => retryDirectoryLoad(directoryError?.path ?? '')}>
                  Retry loading {directoryError.path} directory
                </button>
              </div>
            </div>
          {/if}
          {#if failedRevealPath !== null}
            <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
              <div class="space-y-2">
                <p class="font-medium text-base-content break-all">Unable to reveal {failedRevealPath}</p>
                <button class="btn btn-xs btn-outline" type="button" onclick={() => retryRevealPath(failedRevealPath ?? '')}>
                  Retry revealing {failedRevealPath}
                </button>
              </div>
            </div>
          {/if}
          <div class="min-h-0 flex-1">
            {#if rootEntries.length === 0}
              <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
                This project folder is empty
              </div>
            {:else}
              <ProjectFileTree
                entries={flatEntries}
                expandedDirs={expandedPaths}
                {selectedPath}
                onToggleDir={toggleDir}
                onSelectFile={selectFile}
                initialScrollTop={projectState.treeScrollTop}
                onScrollTopChange={updateTreeScrollTop}
              />
            {/if}
          </div>
        </div>
      </ResizablePanel>

      <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
        {#if selectedPath === null}
          <div class="flex-1 flex items-center justify-center text-base-content/40 text-sm p-6 text-center">
            Select a file to view its content
          </div>
        {:else}
          <FileContentViewer
            {api}
            content={fileContent}
            fileName={selectedFileName}
            filePath={selectedPath}
            projectId={$activeProjectId}
            error={fileError}
            modifiedAt={selectedEntry?.modifiedAt ?? null}
            scrollTop={projectState.contentScrollTop}
            onScrollTopChange={updateContentScrollTop}
            onRetryFile={retrySelectedFile}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>
