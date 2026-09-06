<script lang="ts">
  import { ImagePlus } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import VoiceInput from '../shared/adapters/VoiceInput.svelte'
  import type { TaskCreationAttachments } from './taskCreationAttachments.svelte'

  let { attachments, onTranscription }: {
    attachments: TaskCreationAttachments
    onTranscription: (text: string) => void
  } = $props()

  const pastedImageSummary = $derived(
    `${attachments.state.images.length} image${attachments.state.images.length === 1 ? '' : 's'} ready`,
  )

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

<div>
  <div class="flex items-center gap-3 py-4">
    <Button
      type="button"
      variant="outline"
      onclick={attachments.pasteFromClipboard}
      disabled={attachments.state.pending > 0}
    >
      <ImagePlus size={16} aria-hidden="true" />
      Attach image
    </Button>
    <VoiceInput
      {onTranscription}
      listenToHotkey
      showLabel
      appearance="outline"
      size="md"
    />
    {#if attachments.state.images.length > 0}
      <span class="truncate text-xs text-[var(--of-text-secondary)]" aria-live="polite">{pastedImageSummary}</span>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#if attachments.state.images.length > 0}
      <div class="flex flex-wrap items-center gap-1" aria-label="Pasted image markers">
        {#each attachments.state.images as image (image.id)}
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label="Preview {image.marker}"
            onclick={() => { attachments.state.preview = image }}
          >{image.marker}</Button>
        {/each}
      </div>
    {/if}
    {#if attachments.state.error}
      <p class="m-0 text-xs text-[var(--of-danger)]" role="status" aria-live="polite">{attachments.state.error}</p>
    {/if}
  </div>
</div>

{#if attachments.state.preview}
  <Modal onClose={() => { attachments.state.preview = null }} maxWidth="720px" ariaLabel="Pasted image {attachments.state.preview.marker}" initialFocus={null}>
    {#snippet header()}
      <h3 class="m-0 text-[0.95rem] font-semibold text-[var(--of-text)]">Pasted image {attachments.state.preview.marker}</h3>
    {/snippet}

    <div class="p-4 flex flex-col gap-3">
      <img
        src={attachments.state.preview.dataUrl}
        alt="Pasted image {attachments.state.preview.marker}"
        class="max-h-[70vh] w-full rounded-[var(--of-radius-container)] border border-[var(--of-border)] bg-[var(--of-surface-subtle)] object-contain"
      />
      <p class="m-0 text-xs text-[var(--of-text-secondary)]">{attachments.state.preview.mimeType} · {formatBytes(attachments.state.preview.size)}</p>
    </div>
  </Modal>
{/if}
