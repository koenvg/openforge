import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'

function requireElement<T extends HTMLElement>(value: Element | null, ctor: { new (...args: never[]): T }): T {
  if (!(value instanceof ctor)) {
    throw new Error(`Expected ${ctor.name}`)
  }
  return value
}

function getPanel(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resizable-panel"]'), HTMLElement)
}

function getHandle(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resize-handle"]'), HTMLElement)
}

beforeEach(() => {
  localStorage.clear()
})

describe('ResizablePanel', () => {
  it('renders with default width', () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel).toBeTruthy()
    expect(panel.style.width).toBe('250px')
  })

  it('renders the drag handle', () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const handle = container.querySelector('[data-testid="resize-handle"]')
    expect(handle).toBeTruthy()
  })

  it('restores width from localStorage', () => {
    localStorage.setItem('resizable-panel:test-panel', '320')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('320px')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', 'garbage')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('250px')
  })

  it('rejects partially numeric localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', '320px')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('250px')
  })

  it('clamps restored width to minWidth', () => {
    localStorage.setItem('resizable-panel:test-panel', '50')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, minWidth: 150 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('150px')
  })

  it('clamps restored width to maxWidth', () => {
    localStorage.setItem('resizable-panel:test-panel', '900')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, maxWidth: 500 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('500px')
  })

  it('starts dragging on mousedown on the handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 300 })
    expect(panel.style.width).toBe('300px')

    await fireEvent.mouseUp(document)
  })

  it('persists width to localStorage after drag ends', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-persist', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 300 })
    await fireEvent.mouseUp(document)

    expect(localStorage.getItem('resizable-panel:test-persist')).toBe('300')
  })

  it.each(['left', 'right'] as const)('cancels a %s drag when unmounted so a later panel keeps its own width', async (side) => {
    localStorage.setItem('resizable-panel:test-unmount', '250')
    const first = render(ResizablePanel, {
      props: { storageKey: 'test-unmount', defaultWidth: 250, side },
    })

    await fireEvent.mouseDown(getHandle(first.container), { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: side === 'left' ? 300 : 200 })
    expect(getPanel(first.container).style.width).toBe('300px')

    first.unmount()
    await fireEvent.mouseMove(document, { clientX: side === 'left' ? 350 : 150 })
    await fireEvent.mouseUp(document)
    expect(localStorage.getItem('resizable-panel:test-unmount')).toBe('250')

    const second = render(ResizablePanel, {
      props: { storageKey: 'test-unmount', defaultWidth: 250, side },
    })
    expect(getPanel(second.container).style.width).toBe('250px')

    await fireEvent.mouseDown(getHandle(second.container), { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: side === 'left' ? 280 : 220 })
    await fireEvent.mouseUp(document)
    expect(getPanel(second.container).style.width).toBe('280px')
    expect(localStorage.getItem('resizable-panel:test-unmount')).toBe('280')
  })

  it('releases both document drag listeners when unmounted', async () => {
    const view = render(ResizablePanel, {
      props: { storageKey: 'test-listeners', defaultWidth: 250 },
    })
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    try {
      await fireEvent.mouseDown(getHandle(view.container), { clientX: 250 })
      const dragListeners = added.mock.calls.filter(([type]) => type === 'mousemove' || type === 'mouseup')
      expect(dragListeners.map(([type]) => type).sort()).toEqual(['mousemove', 'mouseup'])

      view.unmount()
      for (const [type, listener] of dragListeners) {
        expect(removed).toHaveBeenCalledWith(type, listener)
      }
    } finally {
      await fireEvent.mouseUp(document)
      added.mockRestore()
      removed.mockRestore()
    }
  })

  it('respects minWidth during drag', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-min', defaultWidth: 250, minWidth: 150, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 50 })
    expect(panel.style.width).toBe('150px')

    await fireEvent.mouseUp(document)
  })

  it('respects maxWidth during drag', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-max', defaultWidth: 250, maxWidth: 400, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 600 })
    expect(panel.style.width).toBe('400px')

    await fireEvent.mouseUp(document)
  })

  it('handles right-side panel dragging (handle on left edge)', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-right', defaultWidth: 300, side: 'right' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 700, right: 1000, top: 0, bottom: 500,
      width: 300, height: 500, x: 700, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 700 })
    await fireEvent.mouseMove(document, { clientX: 650 })
    expect(panel.style.width).toBe('350px')

    await fireEvent.mouseUp(document)
  })

  it('resets to default width on double-click', async () => {
    localStorage.setItem('resizable-panel:test-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.dblClick(handle)
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-reset')).toBeNull()
  })

  it('resizes panel with ArrowRight and ArrowLeft keys on left-side handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-keys-left', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('260px')

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('250px')
  })

  it('resizes panel with ArrowLeft and ArrowRight keys on right-side handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-keys-right', defaultWidth: 250, side: 'right' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('260px')

    await fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('250px')
  })

  it('resets to default width on Enter key', async () => {
    localStorage.setItem('resizable-panel:test-key-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-key-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.keyDown(handle, { key: 'Enter' })
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-key-reset')).toBeNull()
  })

  it('resets to default width on Space key', async () => {
    localStorage.setItem('resizable-panel:test-space-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-space-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.keyDown(handle, { key: ' ' })
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-space-reset')).toBeNull()
  })

  it('labels the keyboard-resizable separator with its current width', () => {
    const { getByRole } = render(ResizablePanel, {
      props: { storageKey: 'test-labelled', defaultWidth: 320, minWidth: 240, maxWidth: 520, label: 'Changed files' },
    })

    const separator = getByRole('separator', { name: 'Resize Changed files panel' })
    expect(separator.getAttribute('aria-valuemin')).toBe('240')
    expect(separator.getAttribute('aria-valuemax')).toBe('520')
    expect(separator.getAttribute('aria-valuenow')).toBe('320')
  })

  it('bounds restored and interactive width to the host without forgetting the preferred width', async () => {
    localStorage.setItem('resizable-panel:host-bound', '500')
    const view = render(ResizablePanel, { storageKey: 'host-bound', defaultWidth: 320, minWidth: 240, maxWidth: 520, availableWidth: 256, side: 'right', label: 'Review' })
    const separator = view.getByRole('separator', { name: 'Resize Review panel' })
    expect(separator.getAttribute('aria-valuenow')).toBe('256')
    expect(separator.getAttribute('aria-valuemax')).toBe('256')
    expect(localStorage.getItem('resizable-panel:host-bound')).toBe('500')
    await view.rerender({ availableWidth: 800 })
    expect(separator.getAttribute('aria-valuenow')).toBe('500')
    await view.rerender({ availableWidth: 256 })
    await fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).toBe('246')
    expect(localStorage.getItem('resizable-panel:host-bound')).toBe('246')
    await view.rerender({ availableWidth: 180 })
    expect(separator.getAttribute('aria-valuemin')).toBe('180')
    expect(separator.getAttribute('aria-valuenow')).toBe('180')
  })
})
