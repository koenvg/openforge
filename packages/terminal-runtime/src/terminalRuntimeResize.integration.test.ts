import {
  createFakeTerminalView,
  createHost,
  resetTerminalRuntimeIntegrationHarness,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime resizing', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('restores sizing and input when an inactive terminal resumes after attachment', async () => {
    const terminalKey = 'T-1'
    const host = createHost()
    const resizePty = vi.spyOn(host, 'resizePty')
    const writePty = vi.spyOn(host, 'writePty')
    const renderHost = document.createElement('div')
    let geometry = { cols: 80, rows: 24 }
    const fit = vi.fn(() => geometry)
    const inputListeners: Array<(data: string) => void> = []
    const view = Object.assign(createFakeTerminalView({
      mount: vi.fn((container: HTMLElement) => container.appendChild(renderHost)),
      unmount: vi.fn(() => renderHost.remove()),
      isMountedIn: vi.fn((container: HTMLElement) => renderHost.parentNode === container),
      fit,
      onUserInput: vi.fn((listener: (data: string) => void) => {
        inputListeners.push(listener)
        return { dispose: vi.fn() }
      }),
    }), { resizeTarget: renderHost })
    Object.defineProperty(view, 'geometry', { get: () => geometry })
    const runtime = createTerminalRuntime(host, { createTerminalView: () => view })
    let observedTarget: Element | null = null
    const resizeCallbacks: ResizeObserverCallback[] = []

    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
      observe(target: Element) { observedTarget = target }
      disconnect() { observedTarget = null }
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
      const wrapper = document.createElement('div')
      await runtime.attach(entry, wrapper)
      expect(fit).toHaveBeenCalledOnce()
      expect(resizePty).not.toHaveBeenCalled()
      const onUserInput = inputListeners[0]
      expect(onUserInput).toBeTypeOf('function')
      onUserInput?.('before resume')
      expect(writePty).not.toHaveBeenCalled()

      runtime.restorePtyInstance(terminalKey, 42)
      expect(fit).toHaveBeenCalledTimes(2)
      expect(resizePty).toHaveBeenLastCalledWith(terminalKey, 80, 24)
      onUserInput?.('continue')
      expect(writePty).toHaveBeenCalledWith(terminalKey, 'continue')

      geometry = { cols: 120, rows: 24 }
      const resizeCallback = resizeCallbacks[0]
      if (observedTarget === renderHost && resizeCallback) {
        resizeCallback(
          [{ contentRect: { width: 960, height: 480 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )
      }
      await vi.advanceTimersByTimeAsync(100)

      expect(fit).toHaveBeenCalledTimes(3)
      expect(resizePty).toHaveBeenLastCalledWith(terminalKey, 120, 24)

      const resizeCallCount = resizePty.mock.calls.length
      geometry = { cols: Number.POSITIVE_INFINITY, rows: 24 }
      if (observedTarget === renderHost && resizeCallback) {
        resizeCallback(
          [{ contentRect: { width: 960, height: 480 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )
      }
      await vi.advanceTimersByTimeAsync(100)

      expect(resizePty).toHaveBeenCalledTimes(resizeCallCount)
    } finally {
      runtime.release(terminalKey)
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
