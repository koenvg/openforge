import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const READY_FONT_READINESS = { status: 'ready' } as const

const mocks = vi.hoisted(() => ({
  terminal: {
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    reset: vi.fn(),
    write: vi.fn((_data: string | Uint8Array, _callback?: () => void) => {}),
    refresh: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
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
    return {
      onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    }
  }),
}))

describe('xterm TerminalView adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.terminal.write.mockReset()
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
      fontReadiness: READY_FONT_READINESS,
    })

    view.mount(firstContainer)
    expect(view.isMountedIn(firstContainer)).toBe(true)

    view.unmount()
    expect(mocks.terminal.blur).toHaveBeenCalledOnce()
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
      fontReadiness: READY_FONT_READINESS,
    })
    const onInput = vi.fn()
    const theme = { background: '#000000' }

    view.mount(container)
    Object.defineProperties(container.firstElementChild, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    })
    view.bootstrap('snapshot', 7, 0)
    view.writeLive({ data: Uint8Array.from([65]), ptyInstanceId: 7, sequence: 1 })
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
    expect(mocks.terminal.write).toHaveBeenNthCalledWith(1, 'snapshot')
    expect(mocks.terminal.write).toHaveBeenNthCalledWith(2, Uint8Array.from([65]))
    expect(mocks.terminal.onData).toHaveBeenCalledOnce()
    expect(onInput).toHaveBeenCalledWith('typed input')
    expect(mocks.terminal.attachCustomKeyEventHandler).toHaveBeenCalledOnce()
    expect(mocks.terminal.options.theme).toBe(theme)
    expect(mocks.terminal.focus).toHaveBeenCalledOnce()
    expect(mocks.terminal.reset).toHaveBeenCalledOnce()
    expect(mocks.fit).toHaveBeenCalledOnce()
  })

  it('discards terminal-generated responses instead of treating them as user input', () => {
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    const onInput = vi.fn()
    view.onUserInput(onInput)
    const onXtermData = mocks.terminal.onData.mock.calls[0]?.[0] as (data: string) => void

    onXtermData('\u001b[1;1R')
    onXtermData('typed input')

    expect(onInput).toHaveBeenCalledOnce()
    expect(onInput).toHaveBeenCalledWith('typed input')
    view.dispose()
  })

  it('applies a font size change to the live xterm instance', () => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })

    view.mount(container)
    Object.defineProperties(container.firstElementChild, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    })
    view.setFontSize(20)

    expect(mocks.terminal.options.fontSize).toBe(20)
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
      fontReadiness: READY_FONT_READINESS,
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

  it('conceals snapshot playback without losing layout, then reveals only a rendered completed screen', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'restoration', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    const host = container.firstElementChild as HTMLElement
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    })
    const restoring = view.replaceSnapshot({ data: 'historical output', ptyInstanceId: null, sequence: 0 })
    expect(host.style.opacity).toBe('0')
    expect(view.fit()).toEqual({ cols: 80, rows: 24 })
    await restoring
    expect(host.style.opacity).toBe('0')
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    await Promise.resolve()
    expect(host.style.opacity).toBe('0')
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.style.opacity).not.toBe('0')
    view.dispose()
  })
  it('reveals a completed terminal after hide and remount without another snapshot', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'restoration', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    const host = container.firstElementChild as HTMLElement
    const present = async () => {
      mocks.writeParsedCallbacks[0]?.()
      mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
      mocks.animationFrameCallbacks.shift()?.(1)
      mocks.animationFrameCallbacks.shift()?.(2)
      await Promise.resolve()
    }
    await view.replaceSnapshot({ data: 'OLD', ptyInstanceId: null, sequence: 0 })
    await present()
    expect(host.style.opacity).not.toBe('0')
    view.setVisible(false)
    view.unmount()
    view.mount(container)
    view.setVisible(true)
    expect(host.style.opacity).toBe('0')
    await present()
    expect(host.style.opacity).not.toBe('0')
    await view.replaceSnapshot({ data: 'CURRENT', ptyInstanceId: null, sequence: 0 })
    await present()
    expect(host.style.opacity).not.toBe('0')
    view.dispose()
  })


  it('opens an empty terminal and accepts ordinary live output without a reveal-frame delay', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'empty', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.setVisible(false)
    view.mount(container)
    view.setVisible(true)
    await view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 })
    const host = container.firstElementChild as HTMLElement
    expect(host.style.opacity).not.toBe('0')
    view.writeLive({ data: 'prompt', ptyInstanceId: 1, sequence: 1 })
    expect(host.style.opacity).not.toBe('0')
    expect(mocks.animationFrameCallbacks).toHaveLength(0)
    view.dispose()
  })

  it('reveals a snapshot restored before mounting only after its first mounted render', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const view = createXtermTerminalView({
      terminalKey: 'late-mount', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    await view.replaceSnapshot({ data: 'READY', ptyInstanceId: null, sequence: 0 })
    const container = document.createElement('div')
    view.mount(container)
    const host = container.firstElementChild as HTMLElement
    expect(host.style.opacity).toBe('0')
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.style.opacity).not.toBe('0')
    view.dispose()
  })

  it('does not expose the previous painted screen when replacing populated output with empty output', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'clear', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    view.writeLive({ data: 'OLD', ptyInstanceId: 1, sequence: 1 })
    mocks.writeParsedCallbacks[0]?.()
    await view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 })
    const host = container.firstElementChild as HTMLElement
    expect(host.style.opacity).toBe('0')
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.style.opacity).not.toBe('0')
    view.dispose()
  })

  it('makes replay inert and defers requested focus until the completed screen is usable', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'focus', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    await view.replaceSnapshot({ data: 'READY', ptyInstanceId: null, sequence: 0 })
    const host = container.firstElementChild as HTMLElement
    expect(host.inert).toBe(true)
    view.focus()
    expect(mocks.terminal.focus).not.toHaveBeenCalled()
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.inert).toBe(false)
    expect(mocks.terminal.focus).toHaveBeenCalledOnce()
    view.dispose()
  })

  it('reveals a successfully restored hidden terminal when it becomes visible', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'hidden-restore', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.setVisible(false)
    view.mount(container)
    await view.replaceSnapshot({ data: 'CURRENT', ptyInstanceId: null, sequence: 0 })
    view.setVisible(false) // An unchanged visibility notification must not cancel restoration.
    view.setVisible(true)
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect((container.firstElementChild as HTMLElement).inert).toBe(false)
    view.dispose()
  })

  it('keeps failed replay concealed and lets a successful retry reveal normally', async () => {
    mocks.terminal.write.mockImplementation((data, callback) => {
      if (data === 'FAIL') throw new Error('parse failed')
      callback?.()
    })
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'retry', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    const host = container.firstElementChild as HTMLElement
    await expect(view.replaceSnapshot({ data: 'FAIL', ptyInstanceId: null, sequence: 0 })).rejects.toThrow('parse failed')
    expect(host.inert).toBe(true)
    await view.replaceSnapshot({ data: 'RETRY', ptyInstanceId: null, sequence: 0 })
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.inert).toBe(false)
    view.dispose()
  })

  it.each(['hide', 'detach', 'dispose', 'replace', 'invalidate'] as const)('ignores an already resolved reveal callback after %s', async action => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'stale-reveal', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    const host = container.firstElementChild as HTMLElement
    await view.replaceSnapshot({ data: 'OLD', ptyInstanceId: null, sequence: 0 })
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    let replacement: Promise<void> | undefined
    if (action === 'hide') view.setVisible(false)
    else if (action === 'detach') view.unmount()
    else if (action === 'dispose') view.dispose()
    else if (action === 'invalidate') view.invalidateSnapshot()
    else replacement = view.replaceSnapshot({ data: 'NEW', ptyInstanceId: null, sequence: 0 })
    await Promise.resolve()
    expect(host.inert).toBe(true)
    await replacement
    view.dispose()
  })

  it('presentation drain includes making the restored screen usable', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'usable', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    await view.replaceSnapshot({ data: 'READY', ptyInstanceId: null, sequence: 0 })
    const host = container.firstElementChild as HTMLElement
    const presented = view.drainPresentation().then(() => { expect(host.inert).toBe(false) })
    mocks.writeParsedCallbacks[0]?.()
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await presented
    view.dispose()
  })

  it('keeps consecutive empty replacements concealed until old pixels have been repainted', async () => {
    mocks.terminal.write.mockImplementation((_data, callback) => callback?.())
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'clear-twice', themeMode: 'dark', openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(container)
    view.writeLive({ data: 'OLD', ptyInstanceId: 1, sequence: 1 })
    mocks.writeParsedCallbacks[0]?.()
    await view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 })
    await view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 })
    const host = container.firstElementChild as HTMLElement
    expect(host.inert).toBe(true)
    mocks.renderCallbacks[0]?.({ start: 0, end: 23 })
    mocks.animationFrameCallbacks.shift()?.(1)
    mocks.animationFrameCallbacks.shift()?.(2)
    await Promise.resolve()
    expect(host.inert).toBe(false)
    view.dispose()
  })

  it('drains only after xterm parses queued writes and presents a renderer frame', async () => {
    const container = document.createElement('div')
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })

    view.mount(container)
    view.bootstrap('queued output', null, 0)
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
      fontReadiness: READY_FONT_READINESS,
    })

    view.mount(container)
    view.bootstrap('queued output', null, 0)
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
      fontReadiness: READY_FONT_READINESS,
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
