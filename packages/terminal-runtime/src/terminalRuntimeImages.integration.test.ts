import { createHost } from './terminalRuntimeHost.testSupport'
import {
  imageAddonMocks,
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime inline image lifecycle', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('loads bounded iTerm image support before advertising the protocol', async () => {
    const runtime = createTerminalRuntime(createHost())

    const entry = await runtime.acquire('T-1')

    expect(imageAddonMocks.instances).toHaveLength(1)
    expect(imageAddonMocks.instances[0].options).toMatchObject({
      pixelLimit: 12_000_000,
      storageLimit: 32,
      iipSizeLimit: 6 * 1024 * 1024,
      iipSupport: true,
      sixelSupport: false,
      showPlaceholder: true,
    })
    expect(runtime.getTerminalImageProtocol(entry)).toBe('iterm2')
  })

  it('keeps the fallback protocol when image rendering is disabled', async () => {
    const host = createHost()
    host.enableImages = false
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire('T-1')

    expect(imageAddonMocks.instances).toHaveLength(0)
    expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
  })

  it('uses the configured logger name when image fallback initialization fails', async () => {
    imageAddonMocks.failLoad = true
    const host = createHost()
    const error = new Error('image addon unavailable')
    host.loggerName = 'terminalPluginPool'
    const runtime = createTerminalRuntime(host)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const entry = await runtime.acquire('T-1')

      expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
      expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(
        '[terminalPluginPool] Inline images unavailable; keeping text fallbacks:',
        error,
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('disposes image rendering when compatibility validation cannot initialize', async () => {
    terminalMocks.failCompatibilityAddon = true
    const runtime = createTerminalRuntime(createHost())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const entry = await runtime.acquire('T-1')

    expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
    expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('resets retained images on reconnect and disposes them with the terminal', async () => {
    const host = createHost()
    host.setBuffer('T-1', 'before')
    const runtime = createTerminalRuntime(host)
    await runtime.acquire('T-1')
    host.setBuffer('T-1', 'after')

    host.emit('openforge-app-events-reconnected', {})
    await vi.waitFor(() => expect(imageAddonMocks.instances[0].reset).toHaveBeenCalled())

    runtime.release('T-1')

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
  })
})
