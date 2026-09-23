<script lang="ts">
  import { onDestroy } from 'svelte'
  import IconButton from './IconButton.svelte'
  import Button from './Button.svelte'
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
  boxClass="mermaid-diagram-preview"
  initialFocus='button[aria-label="Close diagram preview"]'
  onKeydown={handleKeydown}
>
  <div class="preview">
    <header class="mermaid-diagram-preview-toolbar">
      <h2>Mermaid diagram preview</h2>
      <div class="zoom-controls" role="group" aria-label="Diagram zoom controls">
        <IconButton label="Zoom out (-)" tooltipSide="bottom" size="lg" type="button" disabled={!canZoomMermaidOut(zoom, fitScale)} onClick={zoomOut}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3M8 11h6" />
          </svg>
        </IconButton>
        <output aria-live="polite">{zoomLabel}</output>
        <IconButton label="Zoom in (+)" tooltipSide="bottom" size="lg" type="button" disabled={!canZoomMermaidIn(zoom, fitScale)} onClick={zoomIn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
          </svg>
        </IconButton>
        <Button variant="ghost" size="lg" type="button" aria-label="Reset zoom to 100%" title="Reset zoom to 100% (0)" onClick={resetZoom}>100%</Button>
        <Button variant="ghost" size="lg" type="button" aria-label="Fit diagram to window" aria-pressed={zoom.mode === 'fit'} title="Fit diagram to window (F)" onClick={fitToWindow}>Fit</Button>
      </div>
      <IconButton label="Close diagram preview" tooltipSide="bottom" size="lg" type="button" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </IconButton>
    </header>
    <div bind:this={viewport} data-testid="mermaid-preview-viewport" class="viewport">
      <div data-testid="mermaid-preview-canvas" class="canvas">
        <div bind:this={svgHost} class="svg-host">{@html svg}</div>
      </div>
    </div>
  </div>
</Modal>

<style>
  :global(.of-modal-box.mermaid-diagram-preview) { width: calc(100vw - 2rem); height: calc(100vh - 2rem); max-height: calc(100vh - 2rem); }
  .preview { display: flex; min-height: 0; flex: 1; flex-direction: column; background: color-mix(in oklab, var(--of-border) 40%, transparent); }
  header { display: flex; min-height: 3.5rem; flex-shrink: 0; align-items: center; gap: var(--of-space4); border-bottom: var(--of-border-width) solid var(--of-border); background: var(--of-surface); padding: var(--of-space4) var(--of-space6); }
  h2 { margin: 0; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--of-text); font-size: var(--of-text-md); font-weight: 600; }
  .zoom-controls { display: flex; align-items: center; gap: var(--of-space2); }
  output { min-width: 5rem; color: color-mix(in oklab, var(--of-text) 70%, transparent); text-align: center; font-size: var(--of-text-sm); font-variant-numeric: tabular-nums; }
  header :global(svg) { width: 1rem; height: 1rem; }
  header > :global(button:last-child svg) { width: 1.25rem; height: 1.25rem; }
  .viewport { min-height: 0; flex: 1; overflow: auto; padding: var(--of-space6); }
  .canvas { display: flex; width: max-content; min-width: 100%; height: max-content; min-height: 100%; align-items: center; justify-content: center; }
  .svg-host { flex-shrink: 0; }
  @media (max-width: 700px) {
    header { flex-wrap: wrap; height: auto; }
    .zoom-controls { order: 3; width: 100%; min-width: 0; flex-wrap: wrap; justify-content: center; }
  }
  @media (max-width: 400px) {
    .zoom-controls :global(button) { min-width: var(--of-control-height-touch); }
  }
</style>
