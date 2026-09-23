<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import type { FilesBrowserActions, FilesBrowserViewModel } from '../../../plugins/file-viewer/src/lib/fileBrowserView'
  import { createProjectWorkspaceSource } from '../../../plugins/file-viewer/src/lib/workspaceSource'
  import FilesBrowserSection from '../../../plugins/file-viewer/src/FilesBrowserSection.svelte'
  import FileTreeToolbar from '../../../plugins/file-viewer/src/FileTreeToolbar.svelte'
  import FileTreeStates from '../../../plugins/file-viewer/src/FileTreeStates.svelte'
  import FilePreviewPane from '../../../plugins/file-viewer/src/FilePreviewPane.svelte'
  import FileContentViewer from '../../../plugins/file-viewer/src/FileContentViewer.svelte'
  import MarkdownFilePreview from '../../../plugins/file-viewer/src/MarkdownFilePreview.svelte'
  import TaskPaneFrame from './TaskPaneFrame.svelte'
  import { fileViewerProject, markdown } from '../fixtures/fileViewerScenario'

  let { api, module, view, actions }: {
    api: FrontendOpenForgeAPI
    module: 'browser' | 'toolbar' | 'tree' | 'preview' | 'content' | 'markdown'
    view: FilesBrowserViewModel
    actions: FilesBrowserActions
  } = $props()
  const workspaceSource = $derived(createProjectWorkspaceSource(api, fileViewerProject.id))
  const tab = { pluginId: 'com.openforge.file-viewer', contributionId: 'files', namespacedId: 'com.openforge.file-viewer:files', title: 'Files', icon: 'folder-open', order: 20, requiresWorkspace: false }
</script>

<div class="h-screen flex flex-col bg-of-surface">
  <TaskPaneFrame {tab}>
    {#if module === 'browser'}
      <FilesBrowserSection {api} {workspaceSource} {view} {actions} rootErrorTitle="Failed to load files" workspaceLoadingLabel="Loading project files…" rootRetryLabel="Retry loading project files" />
    {:else if module === 'toolbar' || module === 'tree'}
      <div class="w-60 h-full min-h-0 flex flex-col border-r border-of-border">
        {#if module === 'toolbar'}
          <FileTreeToolbar model={view.toolbar} actions={actions.toolbar} />
        {:else}
          <FileTreeStates model={view.tree} actions={actions.tree} />
        {/if}
      </div>
    {:else if module === 'preview'}
      <FilePreviewPane {api} {workspaceSource} model={view.preview} actions={actions.preview} />
    {:else if module === 'content'}
      <FileContentViewer {api} {workspaceSource} content={view.preview.fileContent} fileName={view.preview.selectedFileName} filePath={view.preview.selectedPath ?? ''} error={view.preview.fileError} modifiedAt={view.preview.selectedEntry?.modifiedAt ?? null} onRetryFile={actions.preview.onRetrySelectedFile} />
    {:else}
      <MarkdownFilePreview {api} {workspaceSource} content={markdown} filePath="README.md" />
    {/if}
  </TaskPaneFrame>
</div>
