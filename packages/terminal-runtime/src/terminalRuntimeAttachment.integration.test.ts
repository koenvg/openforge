import {
  attachTestTerminal,
  createHost,
} from './terminalRuntimeHost.testSupport'
import {
  createListenerRegistrationFailureSupport,
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
      await vi.waitFor(() => expect(animationFrames.frames.size).toBe(1))

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
      await vi.waitFor(() => expect(animationFrames.frames.size).toBe(1))
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

  it('parses model output only while a view is attached and restores detached output from authority', async () => {
    const terminalKey = 'T-offscreen-shell-0'
    const host = createHost()
    host.setBuffer(terminalKey, 'initial snapshot')
    const runtime = createTerminalRuntime(host)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {}; unobserve() {} })
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}; disconnect() {}; unobserve() {}; takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0]
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480)

    try {
      const entry = await runtime.acquire(terminalKey)
      const terminal = terminalMocks.instances[0]
      expect(terminal.write).not.toHaveBeenCalled()
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)

      const wrapper = document.createElement('div')
      await runtime.attach(entry, wrapper)
      expect(terminal.write).toHaveBeenCalledTimes(2)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)

      runtime.detach(entry)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)
      host.emit(`pty-model-output-${terminalKey}`, {
        instance_id: 1,
        sequence: 1,
        data: btoa('detached output'),
      })
      expect(terminal.write).toHaveBeenCalledTimes(2)

      host.setBuffer(terminalKey, 'authoritative detached output')
      await runtime.attach(entry, wrapper)
      expect(terminal.write).toHaveBeenCalledTimes(4)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
    } finally {
      runtime.release(terminalKey)
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
      await vi.waitFor(() => expect(animationFrames.frames.size).toBe(1))
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

  it('rereads terminal authority when the first attachment follows unseen output', async () => {
    const terminalKey = 'T-first-attach-shell-0'
    const host = createHost()
    host.setBuffer(terminalKey, 'acquisition snapshot')
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    const terminal = terminalMocks.instances[0]
    expect(terminal.write).not.toHaveBeenCalled()

    host.setBuffer(terminalKey, 'output before first attachment')
    await attachTestTerminal(runtime, entry)

    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write).toHaveBeenNthCalledWith(1, '', expect.any(Function))
    expect(terminal.write).toHaveBeenNthCalledWith(
      2,
      Uint8Array.from(new TextEncoder().encode('output before first attachment')),
      expect.any(Function),
    )
    runtime.release(terminalKey)
  })

  it('rereads authority when a replacement attachment joins stale recovery', async () => {
    const terminalKey = 'T-overlapping-reattach-shell-0'
    const replay = (data: string) => ({
      buffer: null,
      isLive: true,
      instanceId: 1,
      snapshot: { instanceId: 1, watermark: 0, data: btoa(data) },
    })
    let resolveStaleRecovery!: () => void
    const host = createHost()
    host.getPtyBuffer = vi.fn()
      .mockResolvedValueOnce(replay('initial'))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveStaleRecovery = () => resolve(replay('stale recovery'))
      }))
      .mockResolvedValue(replay('latest authority'))
    const reads = vi.spyOn(host, 'getPtyBuffer')
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)

    const staleAttachment = attachTestTerminal(runtime, entry)
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    runtime.detach(entry)
    const currentAttachment = attachTestTerminal(runtime, entry)
    resolveStaleRecovery()

    await Promise.all([staleAttachment, currentAttachment])

    expect(reads).toHaveBeenCalledTimes(3)
    expect(entry.attached).toBe(true)
    expect(entry.viewNeedsRecovery).toBe(false)
    expect(terminalMocks.instances[0].write).toHaveBeenLastCalledWith(
      Uint8Array.from(new TextEncoder().encode('latest authority')),
      expect.any(Function),
    )
    runtime.release(terminalKey)
  })


  it('keeps recovery pending when detachment races an authority read', async () => {
    const terminalKey = 'T-detach-during-recovery-shell-0'
    const host = createHost()
    host.setBuffer(terminalKey, 'initial')
    const reads = vi.spyOn(host, 'getPtyBuffer')
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    const resumeRead = host.deferBufferRead(terminalKey)

    const pendingAttachment = attachTestTerminal(runtime, entry)
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    runtime.detach(entry)
    resumeRead()
    await pendingAttachment

    expect(entry.attached).toBe(false)
    expect(entry.viewNeedsRecovery).toBe(true)
    expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)

    host.setBuffer(terminalKey, 'output after raced detach')
    await attachTestTerminal(runtime, entry)
    expect(entry.viewNeedsRecovery).toBe(false)
    expect(terminalMocks.instances[0].write).toHaveBeenLastCalledWith(
      Uint8Array.from(new TextEncoder().encode('output after raced detach')),
      expect.any(Function),
    )
    runtime.release(terminalKey)
  })


  it('rolls back a failed live-output subscription and retries attachment cleanly', async () => {
    const terminalKey = 'T-subscription-shell-0'
    const listenerRegistrationFailures = createListenerRegistrationFailureSupport()
    const host = createHost({ listenerRegistrationFailures })
    host.setBuffer(terminalKey, 'snapshot')
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    listenerRegistrationFailures.failNext(`pty-model-output-${terminalKey}`)

    await expect(attachTestTerminal(runtime, entry)).rejects.toThrow(
      `listener registration failed: pty-model-output-${terminalKey}`,
    )
    expect(entry.attached).toBe(false)
    expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)

    await attachTestTerminal(runtime, entry)
    expect(entry.attached).toBe(true)
    expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
    runtime.release(terminalKey)
  })
})
