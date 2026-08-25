import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const mocks = vi.hoisted(() => ({
  terminalOptions: [] as Array<Record<string, unknown>>,
  linkCallbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
  loadedAddons: [] as unknown[],
  contextLossCallbacks: [] as Array<() => void>,
  webglDispose: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal(options: Record<string, unknown>) {
    mocks.terminalOptions.push(options)
    return {
      loadAddon: vi.fn((addon: unknown) => mocks.loadedAddons.push(addon)),
      open: vi.fn(),
      dispose: vi.fn(),
      reset: vi.fn(),
      refresh: vi.fn(),
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
  })

  it('configures xterm links and bounded inline image rendering', () => {
    const openLink = vi.fn(async () => undefined)
    const view = createXtermTerminalView({
      terminalKey: 'T-1-shell-0',
      themeMode: 'dark',
      openLink,
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
    })
    view.onRendererFailure(failure)
    view.mount(document.createElement('div'))

    mocks.contextLossCallbacks[0]?.()

    expect(failure).toHaveBeenCalledWith({ renderer: 'webgl', reason: 'context-lost' })
    expect(mocks.webglDispose).toHaveBeenCalledOnce()
  })
})
