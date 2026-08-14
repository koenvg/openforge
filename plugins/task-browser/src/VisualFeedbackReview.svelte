<script lang="ts">
  import { Trash2, X } from '@lucide/svelte'
  import type {
    CaptureAnnotation,
    VisualFeedbackEditorState,
  } from './visualFeedbackEditorState.svelte'

  interface Props {
    editor: VisualFeedbackEditorState
    onClose: () => void
  }

  let { editor, onClose }: Props = $props()

  function captureAnnotations(captureNumber: number): readonly CaptureAnnotation[] {
    return editor.annotations
      .filter(annotation => annotation.captureNumber === captureNumber)
      .sort((left, right) => left.number - right.number)
  }

  function saveAnnotation(event: SubmitEvent, annotation: CaptureAnnotation): void {
    event.preventDefault()
    const values = new FormData(event.currentTarget as HTMLFormElement)
    void editor.updateAnnotation(annotation.number, String(values.get('comment') ?? ''), {
      x: Number(values.get('x')),
      y: Number(values.get('y')),
      width: Number(values.get('width')),
      height: Number(values.get('height')),
    })
  }
</script>

<section
  class="max-h-72 shrink-0 overflow-y-auto border-b border-base-300 bg-base-200/40 px-3 py-3"
  aria-label="Visual feedback review"
>
  <div class="mb-3 flex items-center justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold">Visual feedback review</h2>
      <p class="text-xs text-base-content/60">Correct ordered feedback while keeping the live page available below.</p>
    </div>
    <button class="btn btn-ghost btn-square btn-sm" type="button" aria-label="Close visual feedback review" onclick={onClose}>
      <X size={16} aria-hidden="true" />
    </button>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    {#each editor.captures as capture (capture.number)}
      <article class="rounded-box border border-base-300 bg-base-100 p-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Capture {capture.number}</h3>
          <button
            class="btn btn-ghost btn-xs text-error"
            type="button"
            aria-label={`Remove capture ${capture.number}`}
            disabled={editor.busy}
            onclick={() => void editor.removeCapture(capture.number)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Remove capture
          </button>
        </div>
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
              <form onsubmit={(event) => saveAnnotation(event, annotation)}>
                <label class="font-semibold" for={`annotation-${annotation.number}-comment`}>
                  Annotation {annotation.number}
                </label>
                {#if capture.artifactState !== 'available'}
                  <p class="alert alert-warning mt-2 py-2 text-xs" role="alert">
                    Annotation {annotation.number} background unavailable: {capture.artifactError ?? 'Capture availability is unknown'}
                  </p>
                {/if}
                <textarea
                  id={`annotation-${annotation.number}-comment`}
                  class="textarea textarea-bordered textarea-sm mt-2 w-full"
                  name="comment"
                  aria-label={`Comment for annotation ${annotation.number}`}
                  rows="2"
                >{annotation.comment}</textarea>
                <fieldset class="mt-2 grid grid-cols-4 gap-2">
                  <legend class="sr-only">Normalized marker geometry for annotation {annotation.number}</legend>
                  {#each ['x', 'y', 'width', 'height'] as field}
                    <label class="form-control gap-1">
                      <span class="text-base-content/60">{field}</span>
                      <input
                        class="input input-bordered input-xs min-w-0"
                        type="number"
                        name={field}
                        aria-label={`Annotation ${annotation.number} ${field}`}
                        min="0"
                        max="1"
                        step="any"
                        value={annotation.rect[field as keyof typeof annotation.rect]}
                      />
                    </label>
                  {/each}
                </fieldset>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    type="button"
                    aria-label={`Delete annotation ${annotation.number}`}
                    disabled={editor.busy}
                    onclick={() => void editor.removeAnnotation(annotation.number)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                  <button class="btn btn-primary btn-xs" type="submit" disabled={editor.busy}>
                    Save annotation {annotation.number}
                  </button>
                </div>
              </form>
            </li>
          {/each}
        </ol>
      </article>
    {/each}
  </div>
</section>
