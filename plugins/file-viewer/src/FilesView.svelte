<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import FilesBrowserSection from './FilesBrowserSection.svelte'
  import type { FilesBrowserActions, FilesBrowserViewModel } from './lib/fileBrowserView'
  import type { FileBrowserControllerState } from './lib/fileBrowserControllerState'
  import {
    countDefaultHiddenRootEntries,
    createEmptyFileBrowserProjectState,
    flattenFileBrowserEntries,
    getFileBrowserProjectState,
    updateFileBrowserProjectState,
    type FileBrowserProjectState,
  } from './lib/fileExplorer'
  import { useFileSearchController } from './lib/fileSearchController.svelte'
  import { useFileSelectionController } from './lib/fileSelectionController.svelte'
  import { usePendingFileRevealController } from './lib/pendingFileRevealController.svelte'
  import { useRootLoadingController } from './lib/rootLoadingController.svelte'
  import { activeProjectId, fileBrowserStates, pendingFileReveal } from './lib/stores'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string | null
  }

  let { api, context: _context, projectId = null }: Props = $props()

  $effect(() => {
    $activeProjectId = projectId
  })

  const controllerState: FileBrowserControllerState = {
    get api() { return api },
    getProjectId: () => $activeProjectId,
    getProjectState: (currentProjectId) => getFileBrowserProjectState($fileBrowserStates, currentProjectId),
    updateProjectState: (currentProjectId, updater) => {
      fileBrowserStates.update((states) => updateFileBrowserProjectState(states, currentProjectId, updater))
    },
  }

  const rootLoading = useRootLoadingController(controllerState)
  const fileSelection = useFileSelectionController(controllerState)
  const fileSearch = useFileSearchController(controllerState)
  const pendingReveal = usePendingFileRevealController({
    state: controllerState,
    getPendingPath: () => $pendingFileReveal,
    clearPendingPath: () => pendingFileReveal.set(null),
    setShowHiddenRootEntries: rootLoading.setShowHiddenRootEntries,
    toggleDir: rootLoading.toggleDir,
    selectFile: fileSelection.selectFile,
  })

  const projectState = $derived.by((): FileBrowserProjectState => {
    const currentProjectId = $activeProjectId
    return currentProjectId
      ? getFileBrowserProjectState($fileBrowserStates, currentProjectId)
      : createEmptyFileBrowserProjectState()
  })
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

  const browserView = $derived.by((): FilesBrowserViewModel => ({
    project: {
      id: $activeProjectId,
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
      treeScrollTop: projectState.treeScrollTop,
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
      contentScrollTop: projectState.contentScrollTop,
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
  <FilesBrowserSection {api} view={browserView} actions={browserActions} />
</div>
