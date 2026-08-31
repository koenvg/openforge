<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    FIT_MERMAID_ZOOM,
    calculateMermaidFitScale,
    canZoomMermaidIn,
    canZoomMermaidOut,
    formatMermaidZoomLabel,
    resetMermaidZoom,
    resolveMermaidZoomScale,
    zoomMermaidIn,
    zoomMermaidOut,
    type MermaidSize,
    type MermaidZoomState,
  } from '../mermaidZoom'
  import Modal from './Modal.svelte'

  interface Props {
    svg: string
    onClose: () => void
  }

  let { svg, onClose }: Props = $props()
  let viewport = $state<HTMLDivElement | null>(null)
  let svgHost = $state<HTMLDivElement | null>(null)
  let closeButton = $state<HTMLButtonElement | null>(null)
  let viewportSize = $state<MermaidSize>({ width: 0, height: 0 })
  let zoom = $state<MermaidZoomState>(FIT_MERMAID_ZOOM)
  let resizeObserver: ResizeObserver | undefined

  function readSvgSize(markup: string): MermaidSize | null {
    const template = document.createElement('template')
    template.innerHTML = markup
    const element = template.content.querySelector('svg')
    if (!element) return null

    const viewBox = element.getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number)
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
      return { width: viewBox[2], height: viewBox[3] }
    }

    const width = Number.parseFloat(element.getAttribute('width') ?? '')
    const height = Number.parseFloat(element.getAttribute('height') ?? '')
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? { width, height }
      : null
  }

  let diagramSize = $derived(readSvgSize(svg))
  let fitScale = $derived(diagramSize
    ? calculateMermaidFitScale(diagramSize, viewportSize)
    : null)
  let renderedScale = $derived(resolveMermaidZoomScale(zoom, fitScale))
  let zoomLabel = $derived(formatMermaidZoomLabel(zoom, fitScale))
  let renderedWidth = $derived(diagramSize ? diagramSize.width * renderedScale : null)
  let renderedHeight = $derived(diagramSize ? diagramSize.height * renderedScale : null)

  function updateViewportSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    viewportSize = { width, height }
  }

  $effect(() => {
    if (!viewport || resizeObserver) return

    const bounds = viewport.getBoundingClientRect()
    updateViewportSize(bounds.width, bounds.height)
    if (typeof ResizeObserver !== 'function') return

    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries.find(candidate => candidate.target === viewport)
      if (entry) updateViewportSize(entry.contentRect.width, entry.contentRect.height)
    })
    resizeObserver.observe(viewport)
  })

  $effect(() => {
    void svg
    if (!svgHost || renderedWidth === null || renderedHeight === null) return

    const element = svgHost.querySelector('svg') as SVGSVGElement | null
    if (!element) return
    element.style.display = 'block'
    element.style.width = `${renderedWidth}px`
    element.style.height = `${renderedHeight}px`
    element.style.maxWidth = 'none'
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    resizeObserver = undefined
  })

  function zoomIn() {
    zoom = zoomMermaidIn(zoom, fitScale)
  }

  function zoomOut() {
    zoom = zoomMermaidOut(zoom, fitScale)
  }

  function resetZoom() {
    zoom = resetMermaidZoom()
  }

  function fitToWindow() {
    zoom = FIT_MERMAID_ZOOM
  }

  function handleKeydown(event: KeyboardEvent): boolean | void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return

    if (event.key === '+' || event.key === '=') {
      if (canZoomMermaidIn(zoom, fitScale)) zoomIn()
    } else if (event.key === '-') {
      if (canZoomMermaidOut(zoom, fitScale)) zoomOut()
    } else if (event.key === '0') {
      resetZoom()
    } else if (event.key.toLowerCase() === 'f') {
      fitToWindow()
    } else {
      return
    }

    event.preventDefault()
    return true
  }
</script>

<Modal
  {onClose}
  ariaLabel="Mermaid diagram preview"
  showHeader={false}
  maxWidth="calc(100vw - 2rem)"
  boxClass="mermaid-diagram-preview h-[calc(100vh-2rem)] !max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]"
  initialFocus={() => closeButton}
  onKeydown={handleKeydown}
>
  <div class="flex min-h-0 flex-1 flex-col bg-base-300/40">
    <header class="mermaid-diagram-preview-toolbar flex min-h-14 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2">
      <h2 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-base-content">Mermaid diagram preview</h2>

      <div class="flex items-center gap-1" role="group" aria-label="Diagram zoom controls">
        <button
          type="button"
          class="btn btn-ghost btn-sm h-11 min-h-11 w-11 p-0"
          aria-label="Zoom out"
          title="Zoom out (-)"
          disabled={!canZoomMermaidOut(zoom, fitScale)}
          onclick={zoomOut}
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3M8 11h6" />
          </svg>
        </button>

        <output class="min-w-20 text-center text-xs tabular-nums text-base-content/70" aria-live="polite">{zoomLabel}</output>

        <button
          type="button"
          class="btn btn-ghost btn-sm h-11 min-h-11 w-11 p-0"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={!canZoomMermaidIn(zoom, fitScale)}
          onclick={zoomIn}
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
          </svg>
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-sm h-11 min-h-11 px-3"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100% (0)"
          onclick={resetZoom}
        >100%</button>

        <button
          type="button"
          class="btn btn-ghost btn-sm h-11 min-h-11 px-3"
          aria-label="Fit diagram to window"
          aria-pressed={zoom.mode === 'fit'}
          title="Fit diagram to window (F)"
          onclick={fitToWindow}
        >Fit</button>
      </div>

      <button
        bind:this={closeButton}
        type="button"
        class="btn btn-ghost btn-sm h-11 min-h-11 w-11 p-0"
        aria-label="Close diagram preview"
        onclick={onClose}
      >
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div bind:this={viewport} data-testid="mermaid-preview-viewport" class="mermaid-diagram-preview-viewport min-h-0 flex-1 overflow-auto p-4">
      <div data-testid="mermaid-preview-canvas" class="mermaid-diagram-preview-canvas flex h-max min-h-full w-max min-w-full items-center justify-center">
        <div bind:this={svgHost} class="shrink-0">
          {@html svg}
        </div>
      </div>
    </div>
  </div>
</Modal>
