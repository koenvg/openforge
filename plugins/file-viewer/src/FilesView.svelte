<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import FilesBrowserSection from './FilesBrowserSection.svelte'
  import type { FilesBrowserActions, FilesBrowserViewModel } from './lib/fileBrowserView'
  import type { FileBrowserControllerState } from './lib/fileBrowserControllerState'
  import {
    countDefaultHiddenRootEntries,
    createEmptyFileBrowserWorkspaceState,
    flattenFileBrowserEntries,
    getFileBrowserWorkspaceState,
    updateFileBrowserWorkspaceState,
    type FileBrowserWorkspaceState,
  } from './lib/fileExplorer'
  import { useFileSearchController } from './lib/fileSearchController.svelte'
  import { useFileSelectionController } from './lib/fileSelectionController.svelte'
  import { usePendingFileRevealController } from './lib/pendingFileRevealController.svelte'
  import { useRootLoadingController } from './lib/rootLoadingController.svelte'
  import { fileBrowserStates, pendingFileReveal } from './lib/stores'
  import {
    createProjectWorkspaceSource,
    type FileBrowserWorkspaceSource,
  } from './lib/workspaceSource'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string | null
    workspaceSource?: FileBrowserWorkspaceSource | null
    rootErrorTitle?: string
    workspaceLoadingLabel?: string
    rootRetryLabel?: string
  }

  let {
    api,
    context: _context,
    projectName: _projectName,
    projectId = null,
    workspaceSource = undefined,
    rootErrorTitle = 'Failed to load files',
    workspaceLoadingLabel = 'Loading project files…',
    rootRetryLabel = 'Retry loading project files',
  }: Props = $props()

  const projectWorkspaceSource = $derived(
    projectId ? createProjectWorkspaceSource(api, projectId) : null
  )
  const source = $derived(
    workspaceSource === undefined ? projectWorkspaceSource : workspaceSource
  )

  const controllerState: FileBrowserControllerState = {
    getWorkspaceSource: () => source,
    getWorkspaceState: (workspaceIdentity) => getFileBrowserWorkspaceState($fileBrowserStates, workspaceIdentity),
    updateWorkspaceState: (workspaceIdentity, updater) => {
      fileBrowserStates.update((states) => updateFileBrowserWorkspaceState(states, workspaceIdentity, updater))
    },
  }

  const rootLoading = useRootLoadingController(controllerState)
  const fileSelection = useFileSelectionController(controllerState)
  const fileSearch = useFileSearchController(controllerState)
  const pendingReveal = usePendingFileRevealController({
    state: controllerState,
    getPendingReveal: () => $pendingFileReveal,
    clearPendingReveal: (request) => pendingFileReveal.update((current) => (
      current?.requestId === request.requestId ? null : current
    )),
    setShowHiddenRootEntries: rootLoading.setShowHiddenRootEntries,
    toggleDir: rootLoading.toggleDir,
    selectFile: fileSelection.selectFile,
  })

  const workspaceState = $derived.by((): FileBrowserWorkspaceState => {
    return source
      ? getFileBrowserWorkspaceState($fileBrowserStates, source.identity)
      : createEmptyFileBrowserWorkspaceState()
  })
  const rootEntries = $derived(workspaceState.rootEntries)
  const expandedPaths = $derived(workspaceState.expandedPaths)
  const selectedPath = $derived(workspaceState.selectedPath)
  const fileContent = $derived(workspaceState.fileContent)
  const showHiddenRootEntries = $derived(workspaceState.showHiddenRootEntries)
  const hiddenRootEntryCount = $derived(countDefaultHiddenRootEntries(rootEntries))
  const flatEntries = $derived(flattenFileBrowserEntries(workspaceState))
  const selectedEntry = $derived(
    selectedPath ? flatEntries.find((entry) => entry.path === selectedPath) ?? null : null
  )
  const selectedFileName = $derived(
    selectedPath ? selectedPath.split('/').at(-1) ?? selectedPath : ''
  )

  const browserView = $derived.by((): FilesBrowserViewModel => ({
    workspace: {
      identity: source?.identity ?? null,
      loading: rootLoading.loading,
      rootError: rootLoading.rootError,
    },
    toolbar: {
      searchQuery: fileSearch.query,
      hiddenRootEntryCount,
      showHiddenRootEntries,
    },
    tree: {
      directoryError: rootLoading.directoryError,
      failedRevealPath: pendingReveal.failedPath,
      rootEntries,
      flatEntries,
      expandedPaths,
      selectedPath,
      treeScrollTop: workspaceState.treeScrollTop,
      treeFocusRequest: fileSelection.treeFocusRequest,
      search: {
        active: fileSearch.active,
        loading: fileSearch.loading,
        error: fileSearch.error,
        entries: fileSearch.entries,
        expandedDirs: fileSearch.expandedDirs,
        limitReached: fileSearch.limitReached,
        limit: fileSearch.limit,
      },
    },
    preview: {
      selectedPath,
      selectedEntry,
      selectedFileName,
      fileContent,
      fileError: fileSelection.fileError,
      contentScrollTop: workspaceState.contentScrollTop,
      previewFocusRequest: fileSelection.previewFocusRequest,
    },
  }))

  const browserActions: FilesBrowserActions = {
    onRetryRootLoad: rootLoading.retryRootLoad,
    toolbar: {
      onSearchInput: fileSearch.handleInput,
      onClearSearch: fileSearch.clear,
      onToggleHiddenRootEntries: rootLoading.toggleHiddenRootEntries,
    },
    tree: {
      onRetrySearch: fileSearch.retry,
      onRetryDirectoryLoad: rootLoading.retryDirectoryLoad,
      onRetryRevealPath: pendingReveal.retry,
      onToggleDir: rootLoading.toggleDir,
      onSelectFile: fileSelection.selectFile,
      onTreeScrollTopChange: rootLoading.updateTreeScrollTop,
    },
    preview: {
      onContentScrollTopChange: fileSelection.updateContentScrollTop,
      onRetrySelectedFile: fileSelection.retrySelectedFile,
      onOpenRepositoryPath: async (repositoryPath) => {
        await fileSelection.selectFile(repositoryPath)
      },
      onReturnFocusToSelectedFile: fileSelection.returnFocusToSelectedFile,
    },
  }
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <FilesBrowserSection
    {api}
    workspaceSource={source}
    {rootErrorTitle}
    {workspaceLoadingLabel}
    {rootRetryLabel}
    view={browserView}
    actions={browserActions}
  />
</div>
