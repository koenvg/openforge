<script lang="ts">
  import { FolderCog, Search, X } from '@lucide/svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
  import type { FileBrowserProjectState } from './lib/fileExplorer'
  import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'
  import FileContentViewer from './FileContentViewer.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    activeProjectId: string | null
    loading: boolean
    rootError: string | null
    directoryError: { path: string; message: string } | null
    fileError: string | null
    failedRevealPath: string | null
    rootEntries: FileEntry[]
    flatEntries: FileEntry[]
    expandedPaths: Set<string>
    selectedPath: string | null
    selectedEntry: FileEntry | null
    selectedFileName: string
    projectState: FileBrowserProjectState
    fileContent: FileBrowserProjectState['fileContent']
    previewFocusRequest: number | null
    treeFocusRequest: number | null
    hiddenRootEntryCount: number
    showHiddenRootEntries: boolean
    searchQuery: string
    searchActive: boolean
    searchLoading: boolean
    searchError: string | null
    searchEntries: FileEntry[]
    searchExpandedDirs: Set<string>
    searchLimitReached: boolean
    searchLimit: number
    onSearchInput: (value: string) => void
    onClearSearch: () => void
    onToggleHiddenRootEntries: () => void
    onRetrySearch: () => void
    onRetryRootLoad: () => void
    onRetryDirectoryLoad: (path: string) => void
    onRetrySelectedFile: () => void
    onRetryRevealPath: (path: string) => void
    onToggleDir: (path: string) => Promise<boolean>
    onSelectFile: (path: string) => Promise<boolean>
    onTreeScrollTopChange: (scrollTop: number) => void
    onContentScrollTopChange: (scrollTop: number) => void
    onReturnFocusToSelectedFile: () => void
  }

  let {
    api,
    activeProjectId,
    loading,
    rootError,
    directoryError,
    fileError,
    failedRevealPath,
    rootEntries,
    flatEntries,
    expandedPaths,
    selectedPath,
    selectedEntry,
    selectedFileName,
    projectState,
    fileContent,
    previewFocusRequest,
    treeFocusRequest,
    hiddenRootEntryCount,
    showHiddenRootEntries,
    searchQuery,
    searchActive,
    searchLoading,
    searchError,
    searchEntries,
    searchExpandedDirs,
    searchLimitReached,
    searchLimit,
    onSearchInput,
    onClearSearch,
    onToggleHiddenRootEntries,
    onRetrySearch,
    onRetryRootLoad,
    onRetryDirectoryLoad,
    onRetrySelectedFile,
    onRetryRevealPath,
    onToggleDir,
    onSelectFile,
    onTreeScrollTopChange,
    onContentScrollTopChange,
    onReturnFocusToSelectedFile,
  }: Props = $props()

  const hiddenRootEntriesToggleLabel = $derived(
    showHiddenRootEntries ? 'Hide generated folders' : `Show generated folders (${hiddenRootEntryCount})`,
  )
</script>

<div class="flex flex-1 min-h-0 overflow-hidden bg-base-100">
  {#if !activeProjectId}
    <PluginViewState empty emptyTitle="Select a project to browse files" />
  {:else if loading}
    <PluginViewState loading loadingLabel="Loading project files…" />
  {:else if rootError !== null && rootEntries.length === 0}
    <PluginViewState
      error={rootError}
      errorTitle="Failed to load files"
      retryLabel="Retry loading project files"
      onRetry={onRetryRootLoad}
    />
  {:else}
    <ResizablePanel storageKey="files-tree" defaultWidth={240} side="left">
      <div class="flex h-full min-h-0 flex-col">
        <div class="border-b border-base-300 bg-base-100 p-3">
          <div class="flex items-center gap-2">
            <label class="input input-bordered input-sm flex h-9 min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-base-100 transition-shadow focus-within:border-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/15">
              <Search size={16} class="shrink-0 text-base-content/50" />
              <input
                type="search"
                class="min-w-0 grow"
                placeholder="Search files…"
                aria-label="Search files"
                value={searchQuery}
                oninput={(event) => onSearchInput(event.currentTarget.value)}
              />
              {#if searchQuery.length > 0}
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-xs"
                  aria-label="Clear search"
                  onclick={onClearSearch}
                >
                  <X size={14} />
                </button>
              {/if}
            </label>
            {#if hiddenRootEntryCount > 0}
              <button
                type="button"
                class="btn btn-outline btn-sm btn-square h-9 min-h-9 w-9 shrink-0 {showHiddenRootEntries ? 'border-primary bg-primary/10 text-primary' : ''}"
                aria-label={hiddenRootEntriesToggleLabel}
                title={hiddenRootEntriesToggleLabel}
                aria-pressed={showHiddenRootEntries}
                onclick={onToggleHiddenRootEntries}
              >
                <FolderCog size={16} />
              </button>
            {/if}
          </div>
        </div>
        {#if directoryError !== null}
          <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
            <div class="space-y-2">
              <div>
                <p class="font-medium text-base-content break-all">Unable to load directory {directoryError.path}</p>
                <p class="mt-1 text-error break-words">{directoryError.message}</p>
              </div>
              <button class="btn btn-xs btn-outline" type="button" onclick={() => onRetryDirectoryLoad(directoryError?.path ?? '')}>
                Retry loading {directoryError.path} directory
              </button>
            </div>
          </div>
        {/if}
        {#if failedRevealPath !== null}
          <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
            <div class="space-y-2">
              <p class="font-medium text-base-content break-all">Unable to reveal {failedRevealPath}</p>
              <button class="btn btn-xs btn-outline" type="button" onclick={() => onRetryRevealPath(failedRevealPath ?? '')}>
                Retry revealing {failedRevealPath}
              </button>
            </div>
          </div>
        {/if}
        <div class="min-h-0 flex-1">
          {#if searchActive}
            {#if searchError !== null}
              <div class="p-3 text-xs">
                <div class="space-y-2">
                  <div>
                    <p class="font-medium text-base-content">File search failed</p>
                    <p class="mt-1 text-error break-words">{searchError}</p>
                  </div>
                  <button class="btn btn-xs btn-outline" type="button" onclick={onRetrySearch}>
                    Retry file search
                  </button>
                </div>
              </div>
            {:else if searchEntries.length > 0}
              <div class="flex h-full min-h-0 flex-col">
                <div class="min-h-0 flex-1">
                  <ProjectFileTree
                    entries={searchEntries}
                    expandedDirs={searchExpandedDirs}
                    {selectedPath}
                    onToggleDir={() => {}}
                    onSelectFile={onSelectFile}
                  />
                </div>
                {#if searchLimitReached}
                  <div class="border-t border-base-300 px-3 py-1.5 text-center text-[0.7rem] text-base-content/50">
                    Showing top {searchLimit} results
                  </div>
                {/if}
              </div>
            {:else if searchLoading}
              <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
                Searching…
              </div>
            {:else}
              <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
                No files match your search
              </div>
            {/if}
          {:else if rootEntries.length === 0}
            <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
              This project folder is empty
            </div>
          {:else}
            <ProjectFileTree
              entries={flatEntries}
              expandedDirs={expandedPaths}
              {selectedPath}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              initialScrollTop={projectState.treeScrollTop}
              onScrollTopChange={onTreeScrollTopChange}
              focusSelectedRequest={treeFocusRequest}
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
          projectId={activeProjectId}
          error={fileError}
          modifiedAt={selectedEntry?.modifiedAt ?? null}
          scrollTop={projectState.contentScrollTop}
          onScrollTopChange={onContentScrollTopChange}
          onRetryFile={onRetrySelectedFile}
          onOpenRepositoryPath={async (repositoryPath) => { await onSelectFile(repositoryPath) }}
          focusRequestKey={previewFocusRequest}
          onReturnFocusToTree={onReturnFocusToSelectedFile}
        />
      {/if}
    </div>
  {/if}
</div>
