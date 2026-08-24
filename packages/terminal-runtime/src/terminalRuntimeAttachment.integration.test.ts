import {
  createHost,
  resetTerminalRuntimeIntegrationHarness,
  terminalMocks,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime attachment', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('defers xterm opening and WebGL setup until the first DOM attachment', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    host.setBuffer(terminalKey, '')
    const resizePty = vi.spyOn(host, 'resizePty')
    const runtime = createTerminalRuntime(host)

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0]
    })

    try {
      const entry = await runtime.acquire(terminalKey)
      const terminal = terminalMocks.instances[0]
      Object.defineProperties(entry.hostDiv, {
        clientWidth: { configurable: true, value: 640 },
        clientHeight: { configurable: true, value: 480 },
      })

      expect(terminal.open).not.toHaveBeenCalled()
      expect(entry.webglAddon).toBeNull()

      const wrapper = document.createElement('div')
      await runtime.attach(entry, wrapper)
      const firstWebglAddon = entry.webglAddon

      expect(terminal.open).toHaveBeenCalledOnce()
      expect(terminal.open).toHaveBeenCalledWith(entry.hostDiv)
      expect(firstWebglAddon).not.toBeNull()
      expect(entry.fitAddon.fit).toHaveBeenCalled()
      expect(resizePty).toHaveBeenCalledWith(terminalKey, 80, 24)

      runtime.detach(entry)
      await runtime.attach(entry, wrapper)

      expect(terminal.open).toHaveBeenCalledOnce()
      expect(entry.webglAddon).toBe(firstWebglAddon)
    } finally {
      runtime.release(terminalKey)
      vi.unstubAllGlobals()
    }
  })
})
