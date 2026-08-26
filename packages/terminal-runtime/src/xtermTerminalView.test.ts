import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const mocks = vi.hoisted(() => ({
  terminal: {
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    reset: vi.fn(),
    write: vi.fn((_data: string | Uint8Array, _callback?: () => void) => {}),
    refresh: vi.fn(),
    focus: vi.fn(),
    onData: vi.fn((_listener: (data: string) => void) => ({ dispose: vi.fn() })),
    onWriteParsed: vi.fn((callback: () => void) => {
      mocks.writeParsedCallbacks.push(callback)
      return { dispose: vi.fn() }
    }),
    onRender: vi.fn((callback: (range: { start: number; end: number }) => void) => {
      mocks.renderCallbacks.push(callback)
      return { dispose: vi.fn() }
    }),
    attachCustomKeyEventHandler: vi.fn(),
    getSelection: vi.fn(() => ''),
    cols: 80,
    rows: 24,
    options: {} as Record<string, unknown>,
    buffer: {
      active: {
        type: 'normal' as 'normal' | 'alternate',
        cursorX: 0,
        cursorY: 0,
        viewportY: 0,
        getLine: (_row: number) => undefined as unknown,
      },
    },
  },
  fit: vi.fn(),
  proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
  writeParsedCallbacks: [] as Array<() => void>,
  renderCallbacks: [] as Array<(range: { start: number; end: number }) => void>,
  animationFrameCallbacks: [] as FrameRequestCallback[],
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal() {
    return mocks.terminal
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() {
    return { fit: mocks.fit, proposeDimensions: mocks.proposeDimensions, dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn(function ImageAddon() {
    return { reset: vi.fn(), dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon() {
    return { dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    return { onContextLoss: vi.fn(() => ({ dispose: vi.fn() })), dispose: vi.fn() }
  }),
}))

describe('xterm TerminalView adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeParsedCallbacks.length = 0
    mocks.renderCallbacks.length = 0
    mocks.animationFrameCallbacks.length = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      mocks.animationFrameCallbacks.push(callback)
      return mocks.animationFrameCallbacks.length
    }))
    mocks.terminal.buffer.active = {
      type: 'normal',
      cursorX: 0,
      cursorY: 0,
      viewportY: 0,
      getLine: () => undefined,
    }
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts one renderer host across attachments and disposes the renderer once', () => {
    const firstContainer = document.createElement('div')
    const secondContainer = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })

    view.mount(firstContainer)
    expect(view.isMountedIn(firstContainer)).toBe(true)

    view.unmount()
    view.mount(secondContainer)
    view.dispose()
    view.dispose()

    expect(mocks.terminal.open).toHaveBeenCalledOnce()
    expect(view.isMountedIn(secondContainer)).toBe(false)
    expect(mocks.terminal.dispose).toHaveBeenCalledOnce()
  })

  it('maps renderer-neutral output, input, geometry, selection, focus, reset, and theme capabilities to xterm', () => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })
    const onInput = vi.fn()
    const theme = { background: '#000000' }

    view.mount(container)
    Object.defineProperties(container.firstElementChild, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    })
    view.bootstrap('snapshot', 7)
    view.writeLive({ data: Uint8Array.from([65]), ptyInstanceId: 7 })
    view.onUserInput(onInput)
    const onXtermData = mocks.terminal.onData.mock.calls[0]?.[0] as (data: string) => void
    onXtermData('typed input')
    view.setKeyEventHandler(() => true)
    mocks.terminal.getSelection.mockReturnValue('selected text')
    view.setTheme(theme)
    view.focus()
    view.reset()

    expect(view.fit()).toEqual({ cols: 80, rows: 24 })
    expect(view.geometry).toEqual({ cols: 80, rows: 24 })
    expect(view.getSelectionText()).toBe('selected text')
    expect(mocks.terminal.write).toHaveBeenNthCalledWith(1, 'snapshot', expect.any(Function))
    expect(mocks.terminal.write).toHaveBeenNthCalledWith(2, Uint8Array.from([65]), expect.any(Function))
    expect(mocks.terminal.onData).toHaveBeenCalledOnce()
    expect(onInput).toHaveBeenCalledWith('typed input')
    expect(mocks.terminal.attachCustomKeyEventHandler).toHaveBeenCalledOnce()
    expect(mocks.terminal.options.theme).toBe(theme)
    expect(mocks.terminal.focus).toHaveBeenCalledOnce()
    expect(mocks.terminal.reset).toHaveBeenCalledOnce()
    expect(mocks.fit).toHaveBeenCalledOnce()
  })

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['fractional', 1.5],
    ['zero', 0],
    ['negative', -1],
    ['above the PTY u16 range', 65_536],
  ])('does not pass %s dimensions to xterm fit', (_description, invalidDimension) => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })

    view.mount(container)
    Object.defineProperties(container.firstElementChild, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    })
    mocks.proposeDimensions.mockReturnValueOnce({ cols: invalidDimension, rows: 24 })

    expect(view.fit()).toBeNull()
    expect(mocks.fit).not.toHaveBeenCalled()
  })

  it('drains only after xterm parses queued writes and presents a renderer frame', async () => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })

    view.mount(container)
    view.bootstrap('queued output', null)
    const drained = view.drainPresentation()
    let settled = false
    void drained.then(() => { settled = true })

    await Promise.resolve()
    expect(settled).toBe(false)

    mocks.writeParsedCallbacks[0]?.()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(mocks.terminal.refresh).toHaveBeenCalled()

    mocks.renderCallbacks[0]?.({ start: 2, end: 5 })

    await Promise.resolve()
    expect(settled).toBe(false)

    mocks.animationFrameCallbacks.shift()?.(1)
    await Promise.resolve()
    expect(settled).toBe(false)

    mocks.animationFrameCallbacks.shift()?.(2)

    await expect(drained).resolves.toMatchObject({
      writeGeneration: 1,
      parsedGeneration: 1,
      renderFrame: 1,
      renderedRows: { start: 2, end: 5 },
      renderer: 'xterm-webgl',
    })
  })

  it('rejects an in-flight presentation drain when the view detaches', async () => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })

    view.mount(container)
    view.bootstrap('queued output', null)
    const drained = view.drainPresentation()
    view.unmount()

    await expect(drained).rejects.toThrow('detached before presentation drained')
  })

  it('captures renderer-neutral semantic cells from the visible xterm buffer', () => {
    const cells = [
      {
        getChars: () => 'A', getWidth: () => 1, getFgColorMode: () => 1, getFgColor: () => 1,
        getBgColorMode: () => 0, getBgColor: () => 0, isBold: () => 1, isItalic: () => 0,
        isUnderline: () => 0, isDim: () => 0, isInverse: () => 0, isInvisible: () => 0,
        isStrikethrough: () => 0, isOverline: () => 0,
      },
      {
        getChars: () => '界', getWidth: () => 2, getFgColorMode: () => 0, getFgColor: () => 0,
        getBgColorMode: () => 50331648, getBgColor: () => 0x0cc85a, isBold: () => 0, isItalic: () => 1,
        isUnderline: () => 1, isDim: () => 0, isInverse: () => 0, isInvisible: () => 0,
        isStrikethrough: () => 0, isOverline: () => 0,
      },
    ]
    mocks.terminal.buffer.active = {
      type: 'alternate',
      cursorX: 3,
      cursorY: 1,
      viewportY: 0,
      getLine: row => row === 0 ? {
        isWrapped: false,
        translateToString: () => 'A界',
        getCell: (column: number) => cells[column],
      } : undefined,
    }

    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
    })

    expect(view.capturePresentation()).toMatchObject({
      activeBuffer: 'alternate',
      cursor: { x: 3, y: 1 },
      lines: [{
        row: 0,
        text: 'A界',
        cells: [
          { column: 0, text: 'A', width: 1, foreground: { mode: 1, value: 1 }, bold: true },
          { column: 1, text: '界', width: 2, background: { mode: 50331648, value: 0x0cc85a }, italic: true, underline: true },
        ],
      }],
    })
  })
})
