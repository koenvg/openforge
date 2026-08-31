export const MIN_MERMAID_ZOOM = 0.25
export const MAX_MERMAID_ZOOM = 4
export const MERMAID_ZOOM_STEP = 0.25

export interface MermaidSize {
  width: number
  height: number
}

export type MermaidZoomState =
  | { mode: 'fit' }
  | { mode: 'manual', scale: number }

export const FIT_MERMAID_ZOOM: MermaidZoomState = { mode: 'fit' }

function isPositiveSize(size: MermaidSize): boolean {
  return Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width > 0
    && size.height > 0
}

function clampManualScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_MERMAID_ZOOM, Math.max(MIN_MERMAID_ZOOM, scale))
}

function normalizeScale(scale: number): number {
  return Math.round(scale * 10_000) / 10_000
}

export function calculateMermaidFitScale(content: MermaidSize, viewport: MermaidSize): number | null {
  if (!isPositiveSize(content) || !isPositiveSize(viewport)) return null
  return Math.min(viewport.width / content.width, viewport.height / content.height)
}

export function createManualMermaidZoom(scale: number): MermaidZoomState {
  return { mode: 'manual', scale: clampManualScale(scale) }
}

export function resolveMermaidZoomScale(state: MermaidZoomState, fitScale: number | null): number {
  if (state.mode === 'manual') return state.scale
  return fitScale && fitScale > 0 ? fitScale : 1
}

export function zoomMermaidIn(state: MermaidZoomState, fitScale: number | null): MermaidZoomState {
  const currentScale = resolveMermaidZoomScale(state, fitScale)
  return createManualMermaidZoom(normalizeScale(currentScale + MERMAID_ZOOM_STEP))
}

export function zoomMermaidOut(state: MermaidZoomState, fitScale: number | null): MermaidZoomState {
  const currentScale = resolveMermaidZoomScale(state, fitScale)
  return createManualMermaidZoom(normalizeScale(currentScale - MERMAID_ZOOM_STEP))
}

export function resetMermaidZoom(): MermaidZoomState {
  return createManualMermaidZoom(1)
}

export function canZoomMermaidIn(state: MermaidZoomState, fitScale: number | null): boolean {
  return resolveMermaidZoomScale(state, fitScale) < MAX_MERMAID_ZOOM
}

export function canZoomMermaidOut(state: MermaidZoomState, fitScale: number | null): boolean {
  return resolveMermaidZoomScale(state, fitScale) > MIN_MERMAID_ZOOM
}

export function formatMermaidZoomLabel(state: MermaidZoomState, fitScale: number | null): string {
  const percentage = Math.round(resolveMermaidZoomScale(state, fitScale) * 100)
  return state.mode === 'fit' ? `Fit (${percentage}%)` : `${percentage}%`
}
