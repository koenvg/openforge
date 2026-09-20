<script lang="ts">
  import type { FrontendOpenForgeAPI, TaskBrowserSurfaceController } from '@openforge-app/plugin-sdk/frontend'
  import { onDestroy, onMount } from 'svelte'
  import VisualFeedbackEditor from '../../../plugins/task-browser/src/VisualFeedbackEditor.svelte'
  import VisualFeedbackReview from '../../../plugins/task-browser/src/VisualFeedbackReview.svelte'
  import { createVisualFeedbackEditor } from '../../../plugins/task-browser/src/visualFeedbackEditorState.svelte'
  import { taskBrowserTaskId } from '../fixtures/taskBrowserScenario'

  let { api, module = 'actions', seed = true, saveFailure = false }: {
    api: FrontendOpenForgeAPI
    module?: 'actions' | 'review'
    seed?: boolean
    saveFailure?: boolean
  } = $props()

  let ready = $state(false)
  let error = $state<string | null>(null)
  let surface: TaskBrowserSurfaceController | null = null
  let destroyed = false
  const editor = createVisualFeedbackEditor({
    onError: nextError => { error = nextError },
    persistence: {
      load: async () => null,
      save: async () => {
        if (saveFailure) throw new Error('Catalog draft storage unavailable')
      },
      clear: async () => undefined,
    },
  })

  onMount(() => {
    void (async () => {
      surface = await api.browserSurfaces.getOrCreate({ taskId: taskBrowserTaskId, id: 'component-preview' })
      await editor.setSurface(surface)
      if (seed) await editor.toggle()
      if (!destroyed) ready = true
    })()
  })

  onDestroy(() => {
    destroyed = true
    void editor.destroy()
  })
</script>

<section class="flex min-h-screen flex-col bg-of-canvas p-6" aria-label="Task Browser visual feedback component">
  <div class="mx-auto flex w-full max-w-5xl min-h-[28rem] flex-col overflow-hidden border border-of-border bg-of-surface shadow-sm">
    <header class="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-of-border bg-of-panel px-3 py-1">
      <div class="shrink-0">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-of-text-muted">Task Browser</p>
        <h1 class="text-sm font-semibold text-of-text">Visual feedback</h1>
      </div>
      {#if ready}
        <VisualFeedbackEditor
          available={true}
          {editor}
          reviewing={module === 'review'}
          onReview={() => {}}
          onSend={() => {}}
        />
      {/if}
    </header>

    {#if error}
      <p class="border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error" role="alert">{error}</p>
    {/if}

    {#if !ready}
      <div class="flex flex-1 items-center justify-center text-sm text-of-text-muted" role="status">Preparing visual feedback…</div>
    {:else if module === 'review'}
      <VisualFeedbackReview {editor} onClose={() => {}} />
      <div class="flex flex-1 items-center justify-center bg-of-canvas p-8 text-center text-sm text-of-text-muted">
        The attached page remains available while findings are reviewed.
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center bg-of-canvas p-8 text-center">
        <div class="max-w-md">
          <h2 class="text-xl font-semibold text-of-text">Feedback controls</h2>
          <p class="mt-2 text-sm leading-6 text-of-text-muted">Capture, review, send, undo, and discard actions use the same production controls as the Task Browser toolbar.</p>
        </div>
      </div>
    {/if}
  </div>
</section>
