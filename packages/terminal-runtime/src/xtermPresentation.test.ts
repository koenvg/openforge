import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermPresentationController } from './xtermPresentation'

function createTerminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    rows: 2,
    cols: 4,
    getSelection: vi.fn(() => 'selected'),
    refresh: vi.fn(),
    onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
    onRender: vi.fn(() => ({ dispose: vi.fn() })),
    buffer: {
      active: {
        type: 'normal',
        cursorX: 0,
        cursorY: 0,
        viewportY: 0,
        getLine: () => undefined,
      },
    },
    ...overrides,
  } as unknown as Terminal
}

describe('xterm presentation evidence and capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captures renderer-neutral cells from the visible buffer', () => {
    const cells = [{
      getChars: () => 'A', getWidth: () => 1, getFgColorMode: () => 1, getFgColor: () => 2,
      getBgColorMode: () => 0, getBgColor: () => 0, isBold: () => true, isItalic: () => false,
      isUnderline: () => false, isDim: () => false, isInverse: () => false, isInvisible: () => false,
      isStrikethrough: () => false, isOverline: () => false,
    }]
    const terminal = createTerminal({
      buffer: {
        active: {
          type: 'alternate', cursorX: 3, cursorY: 1, viewportY: 0,
          getLine: row => row === 0 ? {
            isWrapped: false,
            translateToString: () => 'A',
            getCell: (column: number) => cells[column],
          } : undefined,
        },
      } as Terminal['buffer'],
    })
    const presentation = createXtermPresentationController({
      terminal,
      rendererName: () => 'xterm-default',
      canPresent: () => true,
      refresh: () => terminal.refresh(0, terminal.rows - 1),
    })

    expect(presentation.capture()).toMatchObject({
      geometry: { cols: 4, rows: 2 },
      activeBuffer: 'alternate',
      cursor: { x: 3, y: 1 },
      selectionText: 'selected',
      lines: [{
        row: 0,
        text: 'A',
        wrapped: false,
        cells: [{ column: 0, text: 'A', width: 1, foreground: { mode: 1, value: 2 }, bold: true }],
      }],
    })
  })

  it('drains after queued writes parse, render, and cross the paint boundary', async () => {
    const writeParsedCallbacks: Array<() => void> = []
    const renderCallbacks: Array<(range: { start: number; end: number }) => void> = []
    const animationFrames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }))
    const terminal = createTerminal({
      onWriteParsed: vi.fn((callback: () => void) => {
        writeParsedCallbacks.push(callback)
        return { dispose: vi.fn() }
      }),
      onRender: vi.fn((callback: (range: { start: number; end: number }) => void) => {
        renderCallbacks.push(callback)
        return { dispose: vi.fn() }
      }),
    })
    const presentation = createXtermPresentationController({
      terminal,
      rendererName: () => 'xterm-webgl',
      canPresent: () => true,
      refresh: () => terminal.refresh(0, terminal.rows - 1),
    })

    presentation.recordWrite()
    const drained = presentation.drain()
    writeParsedCallbacks[0]?.()
    renderCallbacks[0]?.({ start: 1, end: 3 })
    animationFrames.shift()?.(1)
    animationFrames.shift()?.(2)

    await expect(drained).resolves.toMatchObject({
      writeGeneration: 1,
      parsedGeneration: 1,
      renderFrame: 1,
      renderedRows: { start: 1, end: 3 },
      renderer: 'xterm-webgl',
      geometry: { cols: 4, rows: 2 },
    })
    expect(terminal.refresh).toHaveBeenCalled()
  })

  it('rejects pending drains on detach or disposal and releases event listeners', async () => {
    const writeParsedDisposable = { dispose: vi.fn() }
    const renderDisposable = { dispose: vi.fn() }
    const terminal = createTerminal({
      onWriteParsed: vi.fn(() => writeParsedDisposable),
      onRender: vi.fn(() => renderDisposable),
    })
    const presentation = createXtermPresentationController({
      terminal,
      rendererName: () => 'xterm-default',
      canPresent: () => true,
      refresh: vi.fn(),
    })

    const detached = presentation.drain()
    presentation.detach()
    await expect(detached).rejects.toThrow('detached before presentation drained')

    const disposed = presentation.drain()
    presentation.dispose()
    await expect(disposed).rejects.toThrow('disposed before presentation drained')
    await expect(presentation.drain()).rejects.toThrow('Cannot drain a disposed TerminalView')
    expect(writeParsedDisposable.dispose).toHaveBeenCalledOnce()
    expect(renderDisposable.dispose).toHaveBeenCalledOnce()
  })
})
