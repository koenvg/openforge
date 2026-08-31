import { describe, expect, it } from 'vitest'
import {
  FIT_MERMAID_ZOOM,
  MAX_MERMAID_ZOOM,
  MIN_MERMAID_ZOOM,
  calculateMermaidFitScale,
  canZoomMermaidIn,
  canZoomMermaidOut,
  createManualMermaidZoom,
  formatMermaidZoomLabel,
  resetMermaidZoom,
  resolveMermaidZoomScale,
  zoomMermaidIn,
  zoomMermaidOut,
} from './mermaidZoom'

describe('Mermaid zoom state', () => {
  it('calculates the scale that fits the complete diagram in the viewport', () => {
    expect(calculateMermaidFitScale(
      { width: 1_000, height: 500 },
      { width: 500, height: 400 },
    )).toBe(0.5)
    expect(calculateMermaidFitScale(
      { width: 200, height: 100 },
      { width: 800, height: 600 },
    )).toBe(4)
    expect(calculateMermaidFitScale(
      { width: 0, height: 100 },
      { width: 800, height: 600 },
    )).toBeNull()
  })

  it('resolves fit and manual zoom modes independently', () => {
    expect(resolveMermaidZoomScale(FIT_MERMAID_ZOOM, 0.6)).toBe(0.6)
    expect(resolveMermaidZoomScale(createManualMermaidZoom(1.25), 0.6)).toBe(1.25)
  })

  it('moves in 25 percentage-point steps from the current rendered scale', () => {
    expect(zoomMermaidIn(FIT_MERMAID_ZOOM, 0.6)).toEqual({ mode: 'manual', scale: 0.85 })
    expect(zoomMermaidOut(FIT_MERMAID_ZOOM, 0.6)).toEqual({ mode: 'manual', scale: 0.35 })
    expect(zoomMermaidIn(createManualMermaidZoom(1), 0.6)).toEqual({ mode: 'manual', scale: 1.25 })
    expect(zoomMermaidOut(createManualMermaidZoom(1), 0.6)).toEqual({ mode: 'manual', scale: 0.75 })
  })

  it('clamps manual zoom to the supported limits', () => {
    expect(createManualMermaidZoom(10)).toEqual({ mode: 'manual', scale: MAX_MERMAID_ZOOM })
    expect(createManualMermaidZoom(0.01)).toEqual({ mode: 'manual', scale: MIN_MERMAID_ZOOM })
    expect(zoomMermaidIn(createManualMermaidZoom(MAX_MERMAID_ZOOM), 1)).toEqual({
      mode: 'manual',
      scale: MAX_MERMAID_ZOOM,
    })
    expect(zoomMermaidOut(createManualMermaidZoom(MIN_MERMAID_ZOOM), 1)).toEqual({
      mode: 'manual',
      scale: MIN_MERMAID_ZOOM,
    })
  })

  it('resets to actual size and reports boundary control states', () => {
    expect(resetMermaidZoom()).toEqual({ mode: 'manual', scale: 1 })
    expect(canZoomMermaidIn(createManualMermaidZoom(MAX_MERMAID_ZOOM), 1)).toBe(false)
    expect(canZoomMermaidOut(createManualMermaidZoom(MIN_MERMAID_ZOOM), 1)).toBe(false)
    expect(canZoomMermaidIn(FIT_MERMAID_ZOOM, 0.5)).toBe(true)
    expect(canZoomMermaidOut(FIT_MERMAID_ZOOM, 0.5)).toBe(true)
  })

  it('formats fit and manual zoom labels for display and announcements', () => {
    expect(formatMermaidZoomLabel(FIT_MERMAID_ZOOM, 0.6)).toBe('Fit (60%)')
    expect(formatMermaidZoomLabel(createManualMermaidZoom(1.25), 0.6)).toBe('125%')
  })
})
