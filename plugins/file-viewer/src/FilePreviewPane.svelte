<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import FileContentViewer from './FileContentViewer.svelte'
  import type { FilePreviewActions, FilePreviewModel } from './lib/fileBrowserView'

  interface Props {
    api: FrontendOpenForgeAPI
    projectId: string | null
    model: FilePreviewModel
    actions: FilePreviewActions
  }

  let { api, projectId, model, actions }: Props = $props()
</script>

<div class="flex-1 min-h-0 overflow-hidden flex flex-col">
  {#if model.selectedPath === null}
    <div class="flex-1 flex items-center justify-center text-base-content/40 text-sm p-6 text-center">
      Select a file to view its content
    </div>
  {:else}
    <FileContentViewer
      {api}
      content={model.fileContent}
      fileName={model.selectedFileName}
      filePath={model.selectedPath}
      {projectId}
      error={model.fileError}
      modifiedAt={model.selectedEntry?.modifiedAt ?? null}
      scrollTop={model.contentScrollTop}
      onScrollTopChange={actions.onContentScrollTopChange}
      onRetryFile={actions.onRetrySelectedFile}
      onOpenRepositoryPath={actions.onOpenRepositoryPath}
      focusRequestKey={model.previewFocusRequest}
      onReturnFocusToTree={actions.onReturnFocusToSelectedFile}
    />
  {/if}
</div>
