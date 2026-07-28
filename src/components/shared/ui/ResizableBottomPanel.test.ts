import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { requireElement } from '../../../test-utils/dom'
import ResizableBottomPanel from './ResizableBottomPanel.svelte'

function getPanel(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resizable-bottom-panel"]'), HTMLElement)
}

function getHandle(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resize-handle"]'), HTMLElement)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResizableBottomPanel', () => {
  it('renders with default height', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel).toBeTruthy()
    expect(panel.style.height).toBe('250px')
  })

  it('exposes a keyboard-focusable resize separator when resizable', () => {
    const { getByRole } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = requireElement(getByRole('separator'), HTMLElement)
    expect(handle.dataset.testid).toBe('resize-handle')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(handle.tabIndex).toBe(0)
  })

  it('restores height from localStorage', () => {
    localStorage.setItem('resizable-panel:test-panel', '320')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('320px')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', 'garbage')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('250px')
  })

  it('rejects partially numeric localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', '320px')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('250px')
  })

  it('clamps restored height to minHeight', () => {
    localStorage.setItem('resizable-panel:test-panel', '50')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: 150, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('150px')
  })

  it('clamps restored height to maxHeight', () => {
    localStorage.setItem('resizable-panel:test-panel', '900')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: 500, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('500px')
  })

  it('increases height when dragging handle up (negative Y delta)', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 200 })
    expect(panel.style.height).toBe('300px')

    await fireEvent.mouseUp(document)
  })

  it('decreases height when dragging handle down (positive Y delta)', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 300 })
    expect(panel.style.height).toBe('200px')

    await fireEvent.mouseUp(document)
  })

  it('persists height to localStorage after drag ends', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-persist', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 300 })
    await fireEvent.mouseUp(document)

    expect(localStorage.getItem('resizable-panel:test-persist')).toBe('200')
  })

  it('respects minHeight during drag', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-min', defaultHeight: 250, minHeight: 150, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 50 })
    expect(panel.style.height).toBe('450px')

    await fireEvent.mouseUp(document)
  })

  it('respects maxHeight during drag', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-max', defaultHeight: 250, minHeight: null, maxHeight: 400, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 600 })
    expect(panel.style.height).toBe('100px')

    await fireEvent.mouseUp(document)
  })

  it('resets to default height on double-click', async () => {
    localStorage.setItem('resizable-panel:test-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.dblClick(handle)
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-reset')).toBeNull()
  })

  it('increases height with ArrowUp key', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-keys-up', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(panel.style.height).toBe('260px')
  })

  it('decreases height with ArrowDown key', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-keys-down', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(panel.style.height).toBe('240px')
  })

  it('resets to default height on Enter key', async () => {
    localStorage.setItem('resizable-panel:test-key-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-key-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.keyDown(handle, { key: 'Enter' })
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-key-reset')).toBeNull()
  })

  it('resets to default height on Space key', async () => {
    localStorage.setItem('resizable-panel:test-space-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-space-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.keyDown(handle, { key: ' ' })
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-space-reset')).toBeNull()
  })

  it('uses default minHeight of 100 when not specified', () => {
    localStorage.setItem('resizable-panel:test-default-min', '50')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-default-min', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('100px')
  })

  it('uses default maxHeight of 70% window height when not specified', () => {
    const windowHeight = window.innerHeight
    const expectedMax = Math.floor(windowHeight * 0.7)
    localStorage.setItem('resizable-panel:test-default-max', String(expectedMax + 100))
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-default-max', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe(String(expectedMax) + 'px')
  })

  it('does not expose resize controls when filling the parent', () => {
    const { queryByRole } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-fillparent', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: true },
    })

    expect(queryByRole('separator')).toBeNull()
  })

  it('ignores saved panel height when filling the parent', () => {
    localStorage.setItem('resizable-panel:test-fillparent-height', '320')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-fillparent-height', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: true },
    })
    const panel = getPanel(container)

    expect(panel.style.height).toBe('')
  })

  it('removes active document drag listeners when unmounted', async () => {
    const { container, unmount } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-unmount', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')

    await fireEvent.mouseDown(handle, { clientY: 250 })
    const mouseMoveListener = addEventListener.mock.calls.find(([eventName]) => eventName === 'mousemove')?.[1]
    const mouseUpListener = addEventListener.mock.calls.find(([eventName]) => eventName === 'mouseup')?.[1]
    expect(mouseMoveListener).toBeTypeOf('function')
    expect(mouseUpListener).toBeTypeOf('function')

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('mousemove', mouseMoveListener)
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', mouseUpListener)
  })
})
