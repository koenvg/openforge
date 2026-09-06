import type { TaskDetail } from '../../lib/types'
import { formatTaskPromptWithImageReferences, getTaskPromptImageReferences, getTaskPromptText, type TaskPromptImageReference } from '../../lib/taskPrompt'
import { ClipboardUnavailableError, type TaskCreationAdapter } from './taskCreationAdapter'

interface PastedTaskImage extends TaskPromptImageReference { id: number }
const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024

/** Internal attachment state, owned and reset by the task workflow. */
export function createTaskCreationAttachments(adapter: TaskCreationAdapter) {
  const state = $state({
    images: [] as PastedTaskImage[],
    preview: null as PastedTaskImage | null,
    error: null as string | null,
    pending: 0,
    insertRequest: null as { id: number, marker: string } | null,
  })
  let nextImageId = 1
  let nextRequestId = 1
  let generation = 0

  function reset(mode: 'create' | 'edit', task: TaskDetail | null) {
    generation++
    state.preview = null
    state.error = null
    state.pending = 0
    state.insertRequest = null
    state.images = mode === 'edit' && task
      ? getTaskPromptImageReferences(task)
        .filter((image) => getTaskPromptText(task).includes(image.marker))
        .map((image) => ({ ...image, id: Number(image.marker.match(/\[image#(\d+)\]/)?.[1] ?? '0') }))
      : []
    nextImageId = Math.max(0, ...state.images.map((image) => image.id)) + 1
  }

  async function attachImage(blob: Blob): Promise<string | null> {
    const run = generation
    state.error = null
    const mimeType = blob.type || 'image/png'
    if (!mimeType.startsWith('image/')) {
      state.error = 'Clipboard item is not an image.'
      return null
    }
    if (blob.size > MAX_PASTED_IMAGE_BYTES) {
      state.error = 'Pasted image is too large. Keep images under 5.0 MB.'
      return null
    }
    state.pending++
    try {
      const dataUrl = await adapter.readImage(blob)
      if (run !== generation) return null
      const id = nextImageId++
      const marker = `[image#${id}]`
      state.images = [...state.images, { id, marker, dataUrl, mimeType, size: blob.size }]
      return marker
    } catch {
      if (run === generation) state.error = 'Could not read the pasted image.'
      return null
    } finally {
      if (run === generation) state.pending--
    }
  }

  async function pasteFromClipboard() {
    const run = generation
    state.error = null
    state.pending++
    try {
      const blob = await adapter.readClipboardImage()
      if (run !== generation) return
      if (!blob) {
        state.error = 'Clipboard does not contain an image.'
        return
      }
      const marker = await attachImage(blob)
      if (marker && run === generation) state.insertRequest = { id: nextRequestId++, marker }
    } catch (error) {
      if (run === generation) state.error = error instanceof ClipboardUnavailableError
        ? 'Clipboard image paste is unavailable here.'
        : 'Could not read an image from the clipboard.'
    } finally {
      if (run === generation) state.pending--
    }
  }

  function syncWithPrompt(prompt: string) {
    state.images = state.images.filter((image) => prompt.includes(image.marker))
    if (state.preview && !state.images.some((image) => image.marker === state.preview?.marker)) state.preview = null
  }

  return {
    controls: {
      state, attachImage, pasteFromClipboard, syncWithPrompt,
      openPreview(marker: string) { state.preview = state.images.find((image) => image.marker === marker) ?? null },
    },
    reset,
    formatPrompt(prompt: string) { return formatTaskPromptWithImageReferences(prompt, state.images) },
    getSubmissionError() { return state.pending > 0 ? 'Wait for the pasted image to finish processing.' : null },
    dispose() { generation++; state.pending = 0 },
  }
}

export type TaskCreationAttachments = ReturnType<typeof createTaskCreationAttachments>['controls']
