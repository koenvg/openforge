import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadXtermImageSupport } from './xtermImageSupport'

const mocks = vi.hoisted(() => ({
  imageAddon: { reset: vi.fn(), dispose: vi.fn() },
  compatibilityAddon: { dispose: vi.fn() },
  imageOptions: [] as Array<Record<string, unknown>>,
}))

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn(function ImageAddon(options: Record<string, unknown>) {
    mocks.imageOptions.push(options)
    return mocks.imageAddon
  }),
}))

vi.mock('./terminalImages', async importOriginal => ({
  ...await importOriginal<typeof import('./terminalImages')>(),
  createItermImageCompatibilityAddon: vi.fn(() => mocks.compatibilityAddon),
}))

describe('xterm image support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.imageOptions.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads bounded image rendering and reports the validated protocol', () => {
    const terminal = { loadAddon: vi.fn() } as unknown as Terminal

    const support = loadXtermImageSupport({ terminal })
    support.reset()

    expect(terminal.loadAddon).toHaveBeenNthCalledWith(1, mocks.imageAddon)
    expect(terminal.loadAddon).toHaveBeenNthCalledWith(2, mocks.compatibilityAddon)
    expect(mocks.imageOptions[0]).toMatchObject({
      enableSizeReports: true,
      pixelLimit: 12_000_000,
      storageLimit: 32,
      showPlaceholder: true,
      sixelSupport: false,
      iipSupport: true,
      iipSizeLimit: 6 * 1024 * 1024,
    })
    expect(support.protocol).toBe('iterm2')
    expect(mocks.imageAddon.reset).toHaveBeenCalledOnce()
  })

  it('does not load image addons when images are disabled', () => {
    const terminal = { loadAddon: vi.fn() } as unknown as Terminal

    const support = loadXtermImageSupport({ terminal, enableImages: false })
    support.reset()

    expect(terminal.loadAddon).not.toHaveBeenCalled()
    expect(support.protocol).toBeNull()
    expect(mocks.imageAddon.reset).not.toHaveBeenCalled()
  })

  it('keeps text fallbacks when the image addon cannot load', () => {
    const loadError = new Error('image addon unavailable')
    const terminal = { loadAddon: vi.fn(() => { throw loadError }) } as unknown as Terminal
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const support = loadXtermImageSupport({ terminal, loggerName: 'terminal-test' })

    expect(support.protocol).toBeNull()
    expect(mocks.imageAddon.dispose).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(
      '[terminal-test] Inline images unavailable; keeping text fallbacks:',
      loadError,
    )
  })

  it('disables images when protocol validation cannot load', () => {
    const loadError = new Error('compatibility addon unavailable')
    const terminal = {
      loadAddon: vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw loadError }),
    } as unknown as Terminal
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const support = loadXtermImageSupport({ terminal })

    expect(support.protocol).toBeNull()
    expect(mocks.compatibilityAddon.dispose).toHaveBeenCalledOnce()
    expect(mocks.imageAddon.dispose).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith('[terminalPool] Inline image validation unavailable; keeping text fallbacks:', loadError)
  })
})
