import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MermaidDiagramPreview from './MermaidDiagramPreview.svelte'
import MermaidDiagramPreviewTestWrapper from './MermaidDiagramPreviewTestWrapper.svelte'

const SVG = '<svg role="img" aria-label="Deployment flow" viewBox="0 0 200 100"><text>Safe diagram</text></svg>'

interface MockResizeObserverInstance {
  callback: ResizeObserverCallback
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
}

let resizeObservers: MockResizeObserverInstance[]

function resizePreview(width: number, height: number) {
  const observer = resizeObservers.at(-1)
  if (!observer) throw new Error('Preview did not create a ResizeObserver')

  observer.callback([{
    contentRect: { width, height },
    target: screen.getByTestId('mermaid-preview-viewport'),
  } as ResizeObserverEntry], observer as unknown as ResizeObserver)
}

beforeEach(() => {
  resizeObservers = []
  class MockResizeObserver {
    callback: ResizeObserverCallback
    disconnect = vi.fn()
    observe = vi.fn()
    unobserve = vi.fn()

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      resizeObservers.push(this)
    }
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MermaidDiagramPreview', () => {
  it('opens fitted and sizes the vector diagram to the available viewport', async () => {
    const { container } = render(MermaidDiagramPreview, { props: { svg: SVG, onClose: vi.fn() } })

    expect(screen.getByRole('dialog', { name: 'Mermaid diagram preview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fit diagram to window' }).getAttribute('aria-pressed')).toBe('true')

    resizePreview(400, 300)

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Fit (200%)'))
    const svg = container.querySelector('[data-testid="mermaid-preview-canvas"] svg') as SVGSVGElement
    expect(svg.style.width).toBe('400px')
    expect(svg.style.height).toBe('200px')
    expect(svg.style.maxWidth).toBe('none')
  })

  it('zooms, resets, and fits with visible state and bounded controls', async () => {
    const { container } = render(MermaidDiagramPreview, { props: { svg: SVG, onClose: vi.fn() } })
    resizePreview(200, 100)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Fit (100%)'))

    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('status').textContent).toBe('125%')
    expect((container.querySelector('[data-testid="mermaid-preview-canvas"] svg') as SVGSVGElement).style.width).toBe('250px')

    await fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }))
    expect(screen.getByRole('status').textContent).toBe('100%')

    for (let index = 0; index < 20; index++) {
      await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    }
    expect(screen.getByRole('status').textContent).toBe('400%')
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to window' }))
    expect(screen.getByRole('status').textContent).toBe('Fit (100%)')
  })

  it('supports scoped zoom shortcuts and closes with Escape', async () => {
    const onClose = vi.fn()
    render(MermaidDiagramPreview, { props: { svg: SVG, onClose } })
    resizePreview(200, 100)
    const dialog = screen.getByRole('dialog', { name: 'Mermaid diagram preview' })

    await fireEvent.keyDown(dialog, { key: '+' })
    expect(screen.getByRole('status').textContent).toBe('125%')
    await fireEvent.keyDown(dialog, { key: '-' })
    expect(screen.getByRole('status').textContent).toBe('100%')
    await fireEvent.keyDown(dialog, { key: '0' })
    expect(screen.getByRole('status').textContent).toBe('100%')
    await fireEvent.keyDown(dialog, { key: 'f' })
    expect(screen.getByRole('status').textContent).toBe('Fit (100%)')
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('returns focus to the trigger after the preview closes', async () => {
    render(MermaidDiagramPreviewTestWrapper, { props: { svg: SVG } })
    const trigger = screen.getByRole('button', { name: 'Open diagram' })

    trigger.focus()
    await fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Mermaid diagram preview' })).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'Close diagram preview' }))

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
