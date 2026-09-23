<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { FileContent } from '@openforge-app/plugin-sdk/domain'

  let { content, fileName, modifiedAt, onReturnFocusToTree }: {
    content: FileContent
    fileName: string
    modifiedAt: number | null
    onReturnFocusToTree?: () => void
  } = $props()

  const lineCount = $derived(content.type === 'text' ? content.content.split('\n').length : null)

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatModifiedAt(value: number): string {
    return new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
</script>

<div class="shrink-0 border-b border-of-border bg-of-surface px-5 py-3">
  <div class="flex min-h-9 items-center justify-between gap-4" class:flex-wrap={content.type === 'document' && content.mimeType === 'application/pdf'}>
    <div class="flex min-w-0 flex-wrap items-center gap-y-1">
      <div class="mr-3 text-base font-semibold tracking-tight text-of-text break-all">{fileName}</div>
      <div class="flex flex-wrap items-center gap-y-1 border-l border-of-border pl-3 text-xs text-of-text/60">
        <span>{formatFileSize(content.size)}</span>
        {#if content.mimeType}
          <span class="ml-3 border-l border-of-border pl-3 font-mono">{content.mimeType}</span>
        {/if}
        {#if lineCount !== null}
          <span class="ml-3 border-l border-of-border pl-3">{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
        {/if}
        {#if modifiedAt !== null}
          <span class="ml-3 border-l border-of-border pl-3">Modified {formatModifiedAt(modifiedAt)}</span>
        {/if}
      </div>
    </div>
    {#if onReturnFocusToTree}
      <Button class="shrink-0" variant="outline" size="sm" type="button" onclick={onReturnFocusToTree}>
        Return focus to selected file in tree
      </Button>
    {/if}
  </div>
</div>
