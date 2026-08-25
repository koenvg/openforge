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
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480)

    try {
      const entry = await runtime.acquire(terminalKey)
      const terminal = terminalMocks.instances[0]

      expect(terminal.open).not.toHaveBeenCalled()
      expect(terminal.loadAddon).toHaveBeenCalledTimes(4)

      const wrapper = document.createElement('div')
      await runtime.attach(entry, wrapper)
      const mountedHost = wrapper.firstElementChild

      expect(terminal.open).toHaveBeenCalledOnce()
      expect(terminal.open).toHaveBeenCalledWith(mountedHost)
      expect(terminal.loadAddon).toHaveBeenCalledTimes(5)
      expect(resizePty).toHaveBeenCalledWith(terminalKey, 80, 24)

      runtime.detach(entry)
      await runtime.attach(entry, wrapper)

      expect(terminal.open).toHaveBeenCalledOnce()
      expect(terminal.loadAddon).toHaveBeenCalledTimes(5)
    } finally {
      runtime.release(terminalKey)
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
