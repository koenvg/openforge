import { createHost } from './terminalRuntimeHost.testSupport'
import {
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

function stubAttachmentObservers(): void {
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
}

function stubAnimationFrameQueue() {
  let nextFrameId = 1
  const frames = new Map<number, FrameRequestCallback>()
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId++
    frames.set(frameId, callback)
    return frameId
  })
  const cancelFrame = vi.fn((frameId: number) => {
    frames.delete(frameId)
  })
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)

  return {
    cancelFrame,
    frames,
    runNextFrame() {
      const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!next) return
      const [frameId, callback] = next
      frames.delete(frameId)
      callback(0)
    },
  }
}
describe('terminal runtime attachment', () => {
  beforeEach(resetTerminalRuntimeMocks)

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
    stubAttachmentObservers()
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

  it('stops retrying and reports permanently invalid initial dimensions', async () => {
    const host = createHost()
    const view = createFakeTerminalView({ fit: vi.fn(() => null) })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const animationFrames = stubAnimationFrameQueue()
    stubAttachmentObservers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const entry = await runtime.acquire('T-1-shell-0')
      const attachment = runtime.attach(entry, document.createElement('div'))

      for (let attempt = 0; attempt < 500 && animationFrames.frames.size > 0; attempt += 1) {
        animationFrames.runNextFrame()
      }

      expect(animationFrames.frames.size).toBe(0)
      await expect(attachment).resolves.toMatchObject({ generation: 1 })
      expect(view.fit).toHaveBeenCalled()
      expect(vi.mocked(view.fit).mock.calls.length).toBeLessThan(500)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(
        /initial fit stopped after \d+ animation frames.*dimensions remained invalid/i,
      ))
    } finally {
      runtime.dispose()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('cancels a pending initial-fit frame when detached', async () => {
    const host = createHost()
    const view = createFakeTerminalView({ fit: vi.fn(() => null) })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const animationFrames = stubAnimationFrameQueue()
    stubAttachmentObservers()

    try {
      const entry = await runtime.acquire('T-1-shell-0')
      const attachment = runtime.attach(entry, document.createElement('div'))
      expect(animationFrames.frames.size).toBe(1)

      runtime.detach(entry)

      expect(animationFrames.cancelFrame).toHaveBeenCalledOnce()
      expect(animationFrames.frames.size).toBe(0)
      await expect(attachment).resolves.toMatchObject({ generation: 1 })
      expect(view.unmount).toHaveBeenCalledOnce()
    } finally {
      runtime.dispose()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('cancels a pending initial-fit frame when disposed', async () => {
    const host = createHost()
    const view = createFakeTerminalView({ fit: vi.fn(() => null) })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const animationFrames = stubAnimationFrameQueue()
    stubAttachmentObservers()

    try {
      const entry = await runtime.acquire('T-1-shell-0')
      const attachment = runtime.attach(entry, document.createElement('div'))
      expect(animationFrames.frames.size).toBe(1)

      runtime.dispose()

      expect(animationFrames.cancelFrame).toHaveBeenCalledOnce()
      expect(animationFrames.frames.size).toBe(0)
      await expect(attachment).resolves.toMatchObject({ generation: 1 })
      expect(view.dispose).toHaveBeenCalledOnce()
    } finally {
      runtime.dispose()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
