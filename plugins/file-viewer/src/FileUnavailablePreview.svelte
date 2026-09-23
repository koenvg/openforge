<script lang="ts">
  import { Archive, FileQuestion, TriangleAlert } from '@lucide/svelte'
  import type { FileContent } from '@openforge-app/plugin-sdk/domain'
  import PdfPreview from './PdfPreview.svelte'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'

  let { content, filePath, modifiedAt, workspaceSource }: {
    content: FileContent
    filePath: string
    modifiedAt: number | null
    workspaceSource: FileBrowserWorkspaceSource | null
  } = $props()
</script>

{#if content.type === 'document' && content.mimeType === 'application/pdf' && workspaceSource !== null}
  <PdfPreview {workspaceSource} {filePath} {modifiedAt} />
{:else if content.type === 'binary'}
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="max-w-md text-center space-y-2">
      <Archive class="mx-auto h-8 w-8 text-of-text/50" aria-hidden="true" />
      <h3 class="text-base font-semibold">Binary preview unavailable</h3>
      <p class="text-sm text-of-text/60">
        This file is stored as binary data and cannot be rendered in the preview pane.
      </p>
    </div>
  </div>
{:else if content.type === 'document'}
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="max-w-md text-center space-y-2">
      <FileQuestion class="mx-auto h-8 w-8 text-of-text/50" aria-hidden="true" />
      <h3 class="text-base font-semibold">Document preview unavailable</h3>
      <p class="text-sm text-of-text/60">
        PDFs and similar document formats are shown as metadata-only previews for now.
      </p>
    </div>
  </div>
{:else if content.type === 'large-file'}
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="max-w-md text-center space-y-2">
      <TriangleAlert class="mx-auto h-8 w-8 text-of-text/50" aria-hidden="true" />
      <h3 class="text-base font-semibold">File too large to preview</h3>
      <p class="text-sm text-of-text/60">
        This file exceeds the in-app preview limit, so only its metadata is shown.
      </p>
    </div>
  </div>
{/if}
