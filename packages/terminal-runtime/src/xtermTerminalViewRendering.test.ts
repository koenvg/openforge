import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const READY_FONT_READINESS = { status: 'ready' } as const

const mocks = vi.hoisted(() => ({
  terminalOptions: [] as Array<Record<string, unknown>>,
  terminalOpen: vi.fn(),
  terminalRefresh: vi.fn(),
  linkCallbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
  loadedAddons: [] as unknown[],
  contextLossCallbacks: [] as Array<() => void>,
  webglDispose: vi.fn(),
  webglClearTextureAtlas: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal(options: Record<string, unknown>) {
    mocks.terminalOptions.push(options)
    return {
      loadAddon: vi.fn((addon: unknown) => mocks.loadedAddons.push(addon)),
      open: mocks.terminalOpen,
      dispose: vi.fn(),
      reset: vi.fn(),
      refresh: mocks.terminalRefresh,
      focus: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
      onRender: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn(),
      getSelection: vi.fn(() => ''),
      cols: 80,
      rows: 24,
      options: {},
    }
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() {
    return { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })) }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon(callback: (event: MouseEvent, uri: string) => void) {
    mocks.linkCallbacks.push(callback)
    return { dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn(function ImageAddon(options: Record<string, unknown>) {
    return { options, dispose: vi.fn(), reset: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    return {
      dispose: mocks.webglDispose,
      clearTextureAtlas: mocks.webglClearTextureAtlas,
      onContextLoss: vi.fn((callback: () => void) => {
        mocks.contextLossCallbacks.push(callback)
        return { dispose: vi.fn() }
      }),
    }
  }),
}))

describe('xterm terminal view rendering', () => {
  beforeEach(() => {
    mocks.terminalOptions.length = 0
    mocks.linkCallbacks.length = 0
    mocks.loadedAddons.length = 0
    mocks.contextLossCallbacks.length = 0
    mocks.webglDispose.mockClear()
    mocks.webglClearTextureAtlas.mockClear()
    mocks.terminalOpen.mockClear()
    mocks.terminalRefresh.mockClear()
  })

  it('configures xterm links and bounded inline image rendering', () => {
    const openLink = vi.fn(async () => undefined)
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink,
      fontReadiness: READY_FONT_READINESS,
    })
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    view.mount(document.createElement('div'))
    mocks.linkCallbacks[0]?.(event, 'https://openforge.dev/docs')

    expect(openLink).toHaveBeenCalledWith('https://openforge.dev/docs')
    expect(view.imageProtocol).toBe('iterm2')
    expect(mocks.loadedAddons).toHaveLength(5)
    expect(mocks.terminalOptions[0].linkHandler).toMatchObject({ allowNonHttpProtocols: false })
  })

  it('notifies the runtime when WebGL fails and keeps the default renderer active', () => {
    const failure = vi.fn()
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.onRendererFailure(failure)
    view.mount(document.createElement('div'))

    mocks.contextLossCallbacks[0]?.()

    expect(failure).toHaveBeenCalledWith({ renderer: 'webgl', reason: 'context-lost' })
    expect(mocks.webglDispose).toHaveBeenCalledOnce()
  })

  it('defers default-renderer refresh until a hidden terminal becomes visible', () => {
    const view = createXtermTerminalView({
      terminalKey: 'T-hidden-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: READY_FONT_READINESS,
    })
    view.mount(document.createElement('div'))
    view.setVisible(false)

    mocks.contextLossCallbacks[0]?.()

    expect(mocks.webglDispose).toHaveBeenCalledOnce()
    expect(mocks.terminalRefresh).not.toHaveBeenCalled()

    view.setVisible(true)

    expect(mocks.terminalRefresh).toHaveBeenCalledOnce()
  })

  it('clears the WebGL glyph atlas when delayed bundled fonts become ready', async () => {
    let reportReady!: (outcome: { status: 'ready' }) => void
    const completion = new Promise<{ status: 'ready' }>(resolve => {
      reportReady = resolve
    })
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      fontReadiness: { status: 'timed-out', completion },
    })

    view.mount(document.createElement('div'))
    expect(mocks.webglClearTextureAtlas).not.toHaveBeenCalled()

    reportReady({ status: 'ready' })
    await completion
    await Promise.resolve()

    expect(mocks.webglClearTextureAtlas).toHaveBeenCalledOnce()
  })

  it('reports when delayed bundled font loading fails after xterm opens', async () => {
    const loadError = new Error('delayed font request failed')
    let reportFailure!: (outcome: { status: 'failed'; error: unknown }) => void
    const completion = new Promise<{ status: 'failed'; error: unknown }>(resolve => {
      reportFailure = resolve
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      loggerName: 'Terminal',
      fontReadiness: { status: 'timed-out', completion },
    })

    view.mount(document.createElement('div'))
    reportFailure({ status: 'failed', error: loadError })
    await completion
    await Promise.resolve()

    expect(warn).toHaveBeenLastCalledWith(
      '[Terminal] Bundled terminal fonts failed to load after xterm opened; continuing with fallback fonts:',
      loadError,
    )
  })

  it('reports failed bundled font readiness before opening xterm', () => {
    const loadError = new Error('bundled font unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink: vi.fn(async () => undefined),
      loggerName: 'Terminal',
      fontReadiness: { status: 'failed', error: loadError },
    })

    view.mount(document.createElement('div'))

    expect(warn).toHaveBeenCalledWith(
      '[Terminal] Bundled terminal fonts failed to load; opening xterm with fallback fonts:',
      loadError,
    )
    expect(warn.mock.invocationCallOrder[0]).toBeLessThan(mocks.terminalOpen.mock.invocationCallOrder[0])
  })
})
