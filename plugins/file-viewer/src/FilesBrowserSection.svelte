<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import FilePreviewPane from './FilePreviewPane.svelte'
  import FileTreeStates from './FileTreeStates.svelte'
  import FileTreeToolbar from './FileTreeToolbar.svelte'
  import type { FilesBrowserActions, FilesBrowserViewModel } from './lib/fileBrowserView'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'

  interface Props {
    api: FrontendOpenForgeAPI
    workspaceSource: FileBrowserWorkspaceSource | null
    rootErrorTitle: string
    workspaceLoadingLabel: string
    rootRetryLabel: string
    view: FilesBrowserViewModel
    actions: FilesBrowserActions
  }

  let {
    api,
    workspaceSource,
    rootErrorTitle,
    workspaceLoadingLabel,
    rootRetryLabel,
    view,
    actions,
  }: Props = $props()
</script>

<div class="flex flex-1 min-h-0 flex-col overflow-hidden bg-base-100">

  <div class="flex flex-1 min-h-0 overflow-hidden">
    {#if !view.workspace.identity}
      <PluginViewState empty emptyTitle="Select a project to browse files" />
    {:else if view.workspace.loading}
      <PluginViewState loading loadingLabel={workspaceLoadingLabel} />
    {:else if view.workspace.rootError !== null && view.tree.rootEntries.length === 0}
      <PluginViewState
        error={view.workspace.rootError}
        errorTitle={rootErrorTitle}
        retryLabel={rootRetryLabel}
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
        {workspaceSource}
        model={view.preview}
        actions={actions.preview}
      />
    {/if}
  </div>
</div>
