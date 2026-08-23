import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalEntry, loadWebglAddon } from './terminalRendering'
import type { TerminalRuntimeHost } from './terminalRuntimeTypes'

const mocks = vi.hoisted(() => ({
  terminalOptions: [] as Array<Record<string, unknown>>,
  linkCallbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
  loadedAddons: [] as unknown[],
  webglContextLoss: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal(options: Record<string, unknown>) {
    mocks.terminalOptions.push(options)
    return {
      loadAddon: vi.fn((addon: unknown) => mocks.loadedAddons.push(addon)),
      reset: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() { return {} }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon(callback: (event: MouseEvent, uri: string) => void) {
    mocks.linkCallbacks.push(callback)
    return {}
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
      dispose: vi.fn(),
      onContextLoss: mocks.webglContextLoss.mockReturnValue({ dispose: vi.fn() }),
    }
  }),
}))

function createHost(): TerminalRuntimeHost {
  return {
    listenEvent: vi.fn(),
    getPtyBuffer: vi.fn(),
    writePty: vi.fn(),
    resizePty: vi.fn(),
    openLink: vi.fn(async () => undefined),
  } as unknown as TerminalRuntimeHost
}

describe('terminal rendering', () => {
  beforeEach(() => {
    mocks.terminalOptions.length = 0
    mocks.linkCallbacks.length = 0
    mocks.loadedAddons.length = 0
    mocks.webglContextLoss.mockClear()
  })

  it('configures xterm links and bounded inline image rendering', () => {
    const host = createHost()
    const entry = createTerminalEntry(host, 'T-1-shell-0', 'dark')
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    mocks.linkCallbacks[0]?.(event, 'https://openforge.dev/docs')

    expect(host.openLink).toHaveBeenCalledWith('T-1-shell-0', 'https://openforge.dev/docs')
    expect(entry.imageProtocol).toBe('iterm2')
    expect(mocks.loadedAddons).toHaveLength(4)
    expect(mocks.terminalOptions[0].linkHandler).toMatchObject({ allowNonHttpProtocols: false })
  })

  it('loads WebGL once and retains its context-loss listener', () => {
    const entry = createTerminalEntry(createHost(), 'T-1-shell-0', 'dark')

    loadWebglAddon(entry)
    loadWebglAddon(entry)

    expect(entry.webglAddon).not.toBeNull()
    expect(entry.webglContextLossDisposable).not.toBeNull()
    expect(mocks.webglContextLoss).toHaveBeenCalledOnce()
  })
})
