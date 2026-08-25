import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const mocks = vi.hoisted(() => ({
  terminal: {
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    reset: vi.fn(),
    write: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    attachCustomKeyEventHandler: vi.fn(),
    getSelection: vi.fn(() => ''),
    cols: 80,
    rows: 24,
    options: {} as Record<string, unknown>,
  },
  fit: vi.fn(),
  proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
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
    document.body.innerHTML = ''
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
    view.bootstrap('snapshot')
    view.writeLive({ data: Uint8Array.from([65]), sequence: 7 })
    view.onUserInput(onInput)
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
    expect(mocks.terminal.onData).toHaveBeenCalledWith(onInput)
    expect(mocks.terminal.attachCustomKeyEventHandler).toHaveBeenCalledOnce()
    expect(mocks.terminal.options.theme).toBe(theme)
    expect(mocks.terminal.focus).toHaveBeenCalledOnce()
    expect(mocks.terminal.reset).toHaveBeenCalledOnce()
    expect(mocks.fit).toHaveBeenCalledOnce()
  })
})
