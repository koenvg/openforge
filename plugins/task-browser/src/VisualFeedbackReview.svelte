<script lang="ts">
  import { Trash2, X } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
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
    <IconButton label="Close visual feedback review" size="sm" type="button" onclick={onClose}>
      <X size={16} aria-hidden="true" />
    </IconButton>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    {#each editor.captures as capture (capture.number)}
      <Panel>
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Capture {capture.number}</h3>
          <Button
            variant="ghost"
            size="xs"
            style="color: var(--of-danger);"
            type="button"
            aria-label={`Remove capture ${capture.number}`}
            disabled={editor.busy}
            onclick={() => void editor.removeCapture(capture.number)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Remove capture
          </Button>
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
                {#if capture.artifactState !== 'available'}
                  <p class="mt-2 border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
                    Annotation {annotation.number} background unavailable: {capture.artifactError ?? 'Capture availability is unknown'}
                  </p>
                {/if}
                <Textarea
                  id={`annotation-${annotation.number}-comment`}
                  label={`Annotation ${annotation.number}`}
                  class="mt-2 w-full"
                  name="comment"
                  aria-label={`Comment for annotation ${annotation.number}`}
                  rows={2}
                  value={annotation.comment}
                />
                <fieldset class="mt-2 grid grid-cols-4 gap-2">
                  <legend class="sr-only">Normalized marker geometry for annotation {annotation.number}</legend>
                  {#each ['x', 'y', 'width', 'height'] as field}
                    <TextField
                      label={field}
                      class="min-w-0"
                      type="number"
                      name={field}
                      aria-label={`Annotation ${annotation.number} ${field}`}
                      min="0"
                      max="1"
                      step="any"
                      value={String(annotation.rect[field as keyof typeof annotation.rect])}
                    />
                  {/each}
                </fieldset>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    style="color: var(--of-danger);"
                    type="button"
                    aria-label={`Delete annotation ${annotation.number}`}
                    disabled={editor.busy}
                    onclick={() => void editor.removeAnnotation(annotation.number)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </Button>
                  <Button size="xs" type="submit" disabled={editor.busy}>
                    Save annotation {annotation.number}
                  </Button>
                </div>
              </form>
            </li>
          {/each}
        </ol>
      </Panel>
    {/each}
  </div>
</section>
