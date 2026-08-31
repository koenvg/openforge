<script lang="ts">
  import { ImagePlus } from '@lucide/svelte'
  import type { TaskDetail } from '../../lib/types'
  import {
    formatTaskPromptWithImageReferences,
    getTaskPromptImageReferences,
    getTaskPromptText,
  } from '../../lib/taskPrompt'
  import type { TaskPromptImageReference } from '../../lib/taskPrompt'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import VoiceInput from '../shared/adapters/VoiceInput.svelte'

  interface Props {
    mode: 'create' | 'edit'
    task: TaskDetail | null
    onMarkerInsert: (marker: string) => void
    onMarkerInsertReset: () => void
    onTranscription: (text: string) => void
  }

  interface PastedTaskImage extends TaskPromptImageReference {
    id: number
  }

  const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024

  let { mode, task, onMarkerInsert, onMarkerInsertReset, onTranscription }: Props = $props()

  let pastedImages = $state<PastedTaskImage[]>([])
  let previewImage = $state<PastedTaskImage | null>(null)
  let imagePasteError = $state<string | null>(null)
  let imagePastePending = $state(false)
  let loadedPromptSourceKey = $state<string | null>(null)
  let nextPastedImageId = 1

  const pastedImageSummary = $derived(
    `${pastedImages.length} image${pastedImages.length === 1 ? '' : 's'} ready`,
  )

  function markerId(marker: string): number {
    return Number(marker.match(/\[image#(\d+)\]/)?.[1] ?? '0')
  }

  function taskPromptSourceKey(): string {
    if (mode !== 'edit' || !task) return 'create'
    return `${task.id}\u0000${task.prompt}`
  }

  function imageFromReference(reference: TaskPromptImageReference): PastedTaskImage {
    return {
      ...reference,
      id: markerId(reference.marker),
    }
  }

  $effect(() => {
    const sourceKey = taskPromptSourceKey()
    if (sourceKey === loadedPromptSourceKey) return

    loadedPromptSourceKey = sourceKey
    previewImage = null
    imagePasteError = null
    onMarkerInsertReset()

    if (mode === 'edit' && task) {
      const promptText = getTaskPromptText(task)
      const restoredImages = getTaskPromptImageReferences(task)
        .filter((image) => promptText.includes(image.marker))
        .map(imageFromReference)
      pastedImages = restoredImages
      nextPastedImageId = Math.max(0, ...restoredImages.map((image) => image.id)) + 1
      return
    }

    pastedImages = []
    nextPastedImageId = 1
  })

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('Failed to read image'))
        }
      }
      reader.readAsDataURL(blob)
    })
  }

  export async function attachImage(blob: Blob): Promise<string | null> {
    imagePasteError = null
    imagePastePending = true
    const mimeType = blob.type || 'image/png'
    if (!mimeType.startsWith('image/')) {
      imagePasteError = 'Clipboard item is not an image.'
      imagePastePending = false
      return null
    }
    if (blob.size > MAX_PASTED_IMAGE_BYTES) {
      imagePasteError = `Pasted image is too large. Keep images under ${formatBytes(MAX_PASTED_IMAGE_BYTES)}.`
      imagePastePending = false
      return null
    }

    try {
      const dataUrl = await readBlobAsDataUrl(blob)
      const id = nextPastedImageId
      nextPastedImageId += 1
      const marker = `[image#${id}]`
      pastedImages = [...pastedImages, { id, marker, dataUrl, mimeType, size: blob.size }]
      return marker
    } catch {
      imagePasteError = 'Could not read the pasted image.'
      return null
    } finally {
      imagePastePending = false
    }
  }

  async function pasteImageFromClipboard() {
    imagePasteError = null
    imagePastePending = true

    try {
      if (!navigator.clipboard?.read) {
        imagePasteError = 'Clipboard image paste is unavailable here.'
        return
      }

      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (imageType) {
          const marker = await attachImage(await item.getType(imageType))
          if (marker) onMarkerInsert(marker)
          return
        }
      }
      imagePasteError = 'Clipboard does not contain an image.'
    } catch {
      imagePasteError = 'Could not read an image from the clipboard.'
    } finally {
      imagePastePending = false
    }
  }

  export function openPreview(marker: string) {
    previewImage = pastedImages.find((image) => image.marker === marker) ?? null
  }

  export function syncWithPrompt(prompt: string) {
    const retainedImages = pastedImages.filter((image) => prompt.includes(image.marker))
    if (retainedImages.length === pastedImages.length) return

    pastedImages = retainedImages
    if (previewImage && !retainedImages.some((image) => image.marker === previewImage?.marker)) {
      previewImage = null
    }
  }

  export function formatPrompt(prompt: string): string {
    return formatTaskPromptWithImageReferences(prompt, pastedImages)
  }

  export function getSubmissionError(): string | null {
    return imagePastePending ? 'Wait for the pasted image to finish processing.' : null
  }
</script>

<div>
  <div class="flex items-center gap-3 py-4">
    <button
      type="button"
      class="btn btn-outline h-10 min-h-10 px-4"
      onclick={pasteImageFromClipboard}
      disabled={imagePastePending}
    >
      <ImagePlus size={16} aria-hidden="true" />
      Attach image
    </button>
    <VoiceInput
      {onTranscription}
      listenToHotkey
      showLabel
      appearance="outline"
      size="md"
    />
    {#if pastedImages.length > 0}
      <span class="truncate text-xs text-base-content/60" aria-live="polite">{pastedImageSummary}</span>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#if pastedImages.length > 0}
      <div class="flex flex-wrap items-center gap-1" aria-label="Pasted image markers">
        {#each pastedImages as image (image.id)}
          <button
            type="button"
            class="btn btn-outline btn-xs"
            aria-label="Preview {image.marker}"
            onclick={() => { previewImage = image }}
          >{image.marker}</button>
        {/each}
      </div>
    {/if}
    {#if imagePasteError}
      <p class="m-0 text-xs text-error" role="status" aria-live="polite">{imagePasteError}</p>
    {/if}
  </div>
</div>

{#if previewImage}
  <Modal onClose={() => { previewImage = null }} maxWidth="720px" ariaLabel="Pasted image {previewImage.marker}" initialFocus={null}>
    {#snippet header()}
      <h3 class="text-[0.95rem] font-semibold text-base-content m-0">Pasted image {previewImage.marker}</h3>
    {/snippet}

    <div class="p-4 flex flex-col gap-3">
      <img
        src={previewImage.dataUrl}
        alt="Pasted image {previewImage.marker}"
        class="max-h-[70vh] w-full object-contain rounded border border-base-300 bg-base-200"
      />
      <p class="m-0 text-xs text-base-content/60">{previewImage.mimeType} · {formatBytes(previewImage.size)}</p>
    </div>
  </Modal>
{/if}
