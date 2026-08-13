<script lang="ts">
  import { X } from '@lucide/svelte'
  import type {
    CaptureAnnotation,
    VisualFeedbackCapture,
  } from './visualFeedbackEditorState.svelte'

  interface Props {
    captures: readonly VisualFeedbackCapture[]
    annotations: readonly CaptureAnnotation[]
    onClose: () => void
  }

  let { captures, annotations, onClose }: Props = $props()

  function captureAnnotations(captureNumber: number): readonly CaptureAnnotation[] {
    return annotations
      .filter(annotation => annotation.captureNumber === captureNumber)
      .sort((left, right) => left.number - right.number)
  }
</script>

<section
  class="max-h-64 shrink-0 overflow-y-auto border-b border-base-300 bg-base-200/40 px-3 py-3"
  aria-label="Visual feedback review"
>
  <div class="mb-3 flex items-center justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold">Visual feedback review</h2>
      <p class="text-xs text-base-content/60">Ordered live-page evidence for the next Agent follow-up.</p>
    </div>
    <button class="btn btn-ghost btn-square btn-sm" type="button" aria-label="Close visual feedback review" onclick={onClose}>
      <X size={16} aria-hidden="true" />
    </button>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    {#each captures as capture (capture.number)}
      <article class="rounded-box border border-base-300 bg-base-100 p-3">
        <h3 class="text-sm font-semibold">Capture {capture.number}</h3>
        <dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt class="text-base-content/60">Page</dt>
          <dd class="truncate" title={capture.evidence.title || capture.evidence.url}>
            {capture.evidence.title || capture.evidence.url}
          </dd>
          <dt class="text-base-content/60">URL</dt>
          <dd class="truncate font-mono" title={capture.evidence.url}>{capture.evidence.url}</dd>
          <dt class="text-base-content/60">Captured</dt>
          <dd>{capture.evidence.capturedAt}</dd>
          <dt class="text-base-content/60">Viewport</dt>
          <dd>{capture.evidence.width} × {capture.evidence.height}</dd>
        </dl>

        <ol class="mt-3 space-y-2">
          {#each captureAnnotations(capture.number) as annotation (annotation.number)}
            <li class="rounded-box bg-base-200/60 p-2 text-xs">
              <p class="font-semibold">Annotation {annotation.number}</p>
              <p class="mt-1 whitespace-pre-wrap text-base-content/80">{annotation.comment}</p>
            </li>
          {/each}
        </ol>
      </article>
    {/each}
  </div>
</section>
