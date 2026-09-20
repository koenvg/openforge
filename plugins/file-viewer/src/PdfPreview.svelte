<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'
  import { PdfPreviewController, type PdfState } from './lib/pdf/controller'
  import { registerPdfOwner } from './lib/pdf/lifecycle'

  let { workspaceSource, filePath, modifiedAt, active = true }: {
    workspaceSource: FileBrowserWorkspaceSource | null
    filePath: string
    modifiedAt: number | null
    active?: boolean
  } = $props()
  let region: HTMLDivElement
  let pageContainer: HTMLDivElement
  let controller = $state.raw<PdfPreviewController | null>(null)
  let state = $state<PdfState>({ phase: 'idle', message: '', page: null })
  let intersecting = $state(false)
  let documentVisible = $state(true)
  let reload = $state(0)
  let unregister = () => {}
  let intersection: IntersectionObserver | undefined
  let resize: ResizeObserver | undefined
  const visibilityChanged = () => { documentVisible = document.visibilityState !== 'hidden' }

  onMount(() => {
    controller = new PdfPreviewController(pageContainer, next => { state = next })
    unregister = registerPdfOwner(() => controller?.destroy())
    visibilityChanged()
    document.addEventListener('visibilitychange', visibilityChanged)
    intersection = new IntersectionObserver(entries => { intersecting = entries.some(entry => entry.isIntersecting) })
    intersection.observe(region)
    resize = new ResizeObserver(() => { void controller?.fit() })
    resize.observe(region)
  })

  // Compare logical identity explicitly. No prop-keyed disposal in effect cleanup.
  $effect(() => {
    controller?.transition({ source: workspaceSource, path: filePath, modifiedAt, reload, visible: active && intersecting && documentVisible })
  })

  onDestroy(() => {
    controller?.destroy()
    intersection?.disconnect()
    resize?.disconnect()
    document.removeEventListener('visibilitychange', visibilityChanged)
    unregister()
  })
</script>

<div class="pdf-preview flex min-h-0 flex-1 flex-col" bind:this={region}>
  <div class="shrink-0 space-y-2 px-4 py-3 text-sm" role="status" aria-live="polite" aria-atomic="true">
    {#if state.message}<p>{state.message}</p>{/if}
    {#if state.page}
      <p>{state.page.pages > 1 ? `Page 1 of ${state.page.pages}. Only the first page is available in this preview.` : 'Page 1 of 1'}</p>
      {#if state.page.notice}<p>{state.page.notice}</p>{/if}
      {#if state.page.reduced}<p>Preview resolution was reduced to stay within resource limits.</p>{/if}
    {/if}
  </div>
  {#if state.phase === 'error'}
    <div class="px-4 pb-3"><Button size="sm" variant="outline" onclick={() => { reload++ }}>Retry PDF preview</Button></div>
  {/if}
  <div class="min-h-0 flex-1 overflow-auto px-2 pb-3" role="region" aria-label="PDF first page">
    <div class="pdfViewer" bind:this={pageContainer}></div>
  </div>
</div>
