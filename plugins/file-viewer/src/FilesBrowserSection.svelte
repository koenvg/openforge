<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import FilePreviewPane from './FilePreviewPane.svelte'
  import FileTreeStates from './FileTreeStates.svelte'
  import FileTreeToolbar from './FileTreeToolbar.svelte'
  import type { FilesBrowserActions, FilesBrowserViewModel } from './lib/fileBrowserView'

  interface Props {
    api: FrontendOpenForgeAPI
    view: FilesBrowserViewModel
    actions: FilesBrowserActions
  }

  let { api, view, actions }: Props = $props()
</script>

<div class="flex flex-1 min-h-0 overflow-hidden bg-base-100">
  {#if !view.project.id}
    <PluginViewState empty emptyTitle="Select a project to browse files" />
  {:else if view.project.loading}
    <PluginViewState loading loadingLabel="Loading project files…" />
  {:else if view.project.rootError !== null && view.tree.rootEntries.length === 0}
    <PluginViewState
      error={view.project.rootError}
      errorTitle="Failed to load files"
      retryLabel="Retry loading project files"
      onRetry={actions.onRetryRootLoad}
    />
  {:else}
    <ResizablePanel storageKey="files-tree" defaultWidth={240} side="left">
      <div class="flex h-full min-h-0 flex-col">
        <FileTreeToolbar model={view.toolbar} actions={actions.toolbar} />
        <FileTreeStates model={view.tree} actions={actions.tree} />
      </div>
    </ResizablePanel>

    <FilePreviewPane
      {api}
      projectId={view.project.id}
      model={view.preview}
      actions={actions.preview}
    />
  {/if}
</div>
