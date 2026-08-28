import { vi } from 'vitest'

const hoistedTerminalMocks = vi.hoisted(() => ({
  failCompatibilityAddon: false,
  failImageAddon: false,
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    blur: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    onWriteParsed: ReturnType<typeof vi.fn>
    onRender: ReturnType<typeof vi.fn>
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
    cols: number
    rows: number
    options: Record<string, unknown>
  }>,
}))

const hoistedWebLinkMocks = vi.hoisted(() => ({
  callbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
}))

const hoistedImageAddonMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>
    reset: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

export const terminalMocks = {
  get failCompatibilityAddon() { return hoistedTerminalMocks.failCompatibilityAddon },
  set failCompatibilityAddon(value: boolean) { hoistedTerminalMocks.failCompatibilityAddon = value },
  get instances() { return hoistedTerminalMocks.instances },
}

export const xtermAddonMockState = {
  get failImageAddon() { return hoistedTerminalMocks.failImageAddon },
  set failImageAddon(value: boolean) { hoistedTerminalMocks.failImageAddon = value },
  get imageAddonInstances() { return hoistedImageAddonMocks.instances },
  get webLinkCallbacks() { return hoistedWebLinkMocks.callbacks },
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal() {
    const loadedAddons: Array<{ dispose?: () => void }> = []
    const terminal = {
      write: vi.fn(),
      reset: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(() => {
        for (const addon of loadedAddons) addon.dispose?.()
      }),
      refresh: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      loadAddon: vi.fn((addon: { activate?: unknown; dispose?: () => void; options?: { iipSupport?: boolean } }) => {
        if (hoistedTerminalMocks.failImageAddon && addon.options?.iipSupport) {
          throw new Error('image addon unavailable')
        }
        if (hoistedTerminalMocks.failCompatibilityAddon && addon.activate && !addon.options?.iipSupport) {
          throw new Error('compatibility addon unavailable')
        }
        loadedAddons.push(addon)
      }),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
      onRender: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn(),
      cols: 80,
      rows: 24,
      options: {},
    }
    hoistedTerminalMocks.instances.push(terminal)
    return terminal
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
      dispose: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon(callback: (event: MouseEvent, uri: string) => void) {
    hoistedWebLinkMocks.callbacks.push(callback)
    return { dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    return {
      dispose: vi.fn(),
      onContextLoss: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }
  }),
}))

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn(function ImageAddon(options: Record<string, unknown>) {
    const addon = {
      options,
      reset: vi.fn(),
      dispose: vi.fn(),
    }
    hoistedImageAddonMocks.instances.push(addon)
    return addon
  }),
}))
