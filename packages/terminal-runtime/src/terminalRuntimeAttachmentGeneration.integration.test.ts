import { describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal attachment generations', () => {
  it('rejects detach from a superseded attachment after the Terminal Session moves to another surface', async () => {
    let mountedIn: HTMLElement | null = null
    const view = createFakeTerminalView({
      mount: vi.fn((container: HTMLElement) => { mountedIn = container }),
      unmount: vi.fn(() => { mountedIn = null }),
      isMountedIn: vi.fn((container: HTMLElement) => mountedIn === container),
      fit: vi.fn(() => ({ cols: 80, rows: 24 })),
    })
    const runtime = createTerminalRuntime({ ...createHost(), createTerminalView: () => view })

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
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0]
    })

    try {
      const entry = await runtime.acquire('T-1-shell-0')
      const firstHost = document.createElement('div')
      const secondHost = document.createElement('div')
      const firstAttachment = await runtime.attach(entry, firstHost)
      const secondAttachment = await runtime.attach(entry, secondHost)

      firstAttachment.detach()

      expect(view.isMountedIn(secondHost)).toBe(true)
      expect(runtime.diagnostics.observe('T-1-shell-0')?.view.attached).toBe(true)

      secondAttachment.detach()

      expect(runtime.diagnostics.observe('T-1-shell-0')?.view.attached).toBe(false)
      expect(view.unmount).toHaveBeenCalledTimes(2)
    } finally {
      runtime.release('T-1-shell-0')
      vi.unstubAllGlobals()
    }
  })
})
