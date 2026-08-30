import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView, INLINE_IMAGE_COMPATIBILITY_REPLAY } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

interface VisibilityHarness {
  show(isVisible: boolean): void
}

function installVisibilityHarness(emitInitialVisibility = true): VisibilityHarness {
  let callback: IntersectionObserverCallback | null = null
  let target: Element | null = null

  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    frame(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = [0]

    constructor(nextCallback: IntersectionObserverCallback) {
      callback = nextCallback
    }

    observe(nextTarget: Element) {
      target = nextTarget
      if (emitInitialVisibility) this.emit(false)
    }

    private emit(isIntersecting: boolean) {
      callback?.([{ isIntersecting, target: target! } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }

    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
  })

  return {
    show(isVisible) {
      if (!callback || !target) throw new Error('Terminal visibility observer is not active')
      callback([{
        isIntersecting: isVisible,
        target,
      } as IntersectionObserverEntry], {} as IntersectionObserver)
    },
  }
}

describe('terminal runtime visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('settles attachment when detached before the initial visibility notification', async () => {
    const terminalKey = 'T-detach-before-visibility-shell-0'
    installVisibilityHarness(false)
    const host = createHost()
    host.setBuffer(terminalKey, 'snapshot')
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    try {
      const entry = await runtime.acquire(terminalKey)
      const pendingAttachment = runtime.attach(entry, document.createElement('div'))
      await vi.waitFor(() => expect(entry.attached).toBe(true))

      runtime.detach(entry)

      await expect(pendingAttachment).resolves.toMatchObject({ generation: 1 })
      expect(entry.attached).toBe(false)
      expect(entry.visibilityObserver).toBeNull()
    } finally {
      runtime.dispose()
    }
  })

  it('suspends live xterm writes while mounted offscreen and restores Ghostty authority when visible', async () => {
    const terminalKey = 'T-visibility-shell-0'
    const visibility = installVisibilityHarness()
    const host = createHost()
    host.setBuffer(terminalKey, 'initial snapshot')
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    try {
      const entry = await runtime.acquire(terminalKey)
      await runtime.attach(entry, document.createElement('div'))

      expect(view.replaceSnapshot).not.toHaveBeenCalled()
      expect(view.setVisible).toHaveBeenLastCalledWith(false)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)

      visibility.show(true)
      await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledOnce())
      expect(view.setVisible).toHaveBeenLastCalledWith(true)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)

      visibility.show(false)
      await vi.waitFor(() => expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0))
      expect(view.setVisible).toHaveBeenLastCalledWith(false)

      for (let sequence = 1; sequence <= 100; sequence += 1) {
        host.emit(`pty-model-output-${terminalKey}`, {
          data: btoa(`hidden ${sequence}`),
          instance_id: 1,
          sequence,
        })
      }
      expect(view.writeLive).not.toHaveBeenCalled()

      host.setBuffer(terminalKey, 'authoritative hidden burst')
      visibility.show(true)

      await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledTimes(2))
      expect(view.replaceSnapshot).toHaveBeenLastCalledWith({
        data: Uint8Array.from(new TextEncoder().encode('authoritative hidden burst')),
        ptyInstanceId: 1,
        sequence: 0,
      })
      expect(view.writeLive).not.toHaveBeenCalled()
      expect(entry.attached).toBe(true)
      expect(entry.viewVisible).toBe(true)
    } finally {
      runtime.dispose()
    }
  })

  it('restores compatibility state before the Ghostty snapshot after a hidden remount', async () => {
    const terminalKey = 'T-hidden-remount-shell-0'
    const visibility = installVisibilityHarness()
    const host = createHost()
    host.setBuffer(terminalKey, 'before hidden')
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    try {
      const entry = await runtime.acquire(terminalKey)
      const firstAttachment = await runtime.attach(entry, document.createElement('div'))
      visibility.show(true)
      await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledOnce())

      visibility.show(false)
      firstAttachment.detach()
      host.getPtyBuffer = vi.fn(async () => ({
        buffer: null,
        isLive: true,
        instanceId: 1,
        snapshot: {
          instanceId: 1,
          watermark: 8,
          data: btoa('remounted snapshot'),
          compatibilityData: btoa(INLINE_IMAGE_COMPATIBILITY_REPLAY),
        },
      }))

      await runtime.attach(entry, document.createElement('div'))
      expect(view.replaceSnapshot).toHaveBeenCalledOnce()

      visibility.show(true)
      await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledTimes(2))
      expect(view.replaceSnapshot).toHaveBeenLastCalledWith({
        data: Uint8Array.from(new TextEncoder().encode('remounted snapshot')),
        compatibilityData: Uint8Array.from(new TextEncoder().encode(INLINE_IMAGE_COMPATIBILITY_REPLAY)),
        ptyInstanceId: 1,
        sequence: 0,
      })
      expect(entry.terminalModelSequence).toBe(8)
    } finally {
      runtime.dispose()
    }
  })

  it('rereads authority when visibility changes during snapshot replacement', async () => {
    const terminalKey = 'T-snapshot-visibility-race-shell-0'
    const visibility = installVisibilityHarness()
    const host = createHost()
    host.setBuffer(terminalKey, 'stale snapshot')
    let finishReplacement!: () => void
    const pendingReplacement = new Promise<void>(resolve => { finishReplacement = resolve })
    const replaceSnapshot = vi.fn()
      .mockImplementationOnce(() => pendingReplacement)
      .mockResolvedValue(undefined)
    const view = createFakeTerminalView({ replaceSnapshot })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    try {
      const entry = await runtime.acquire(terminalKey)
      await runtime.attach(entry, document.createElement('div'))

      visibility.show(true)
      await vi.waitFor(() => expect(replaceSnapshot).toHaveBeenCalledOnce())
      visibility.show(false)
      host.setBuffer(terminalKey, 'latest hidden output')
      visibility.show(true)
      finishReplacement()

      await vi.waitFor(() => expect(replaceSnapshot).toHaveBeenCalledTimes(2))
      expect(replaceSnapshot).toHaveBeenLastCalledWith({
        data: Uint8Array.from(new TextEncoder().encode('latest hidden output')),
        ptyInstanceId: 1,
        sequence: 0,
      })
      expect(entry.viewNeedsRecovery).toBe(false)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
    } finally {
      runtime.dispose()
    }
  })

  it('retries a transient snapshot failure without freezing a visible terminal', async () => {
    const terminalKey = 'T-visibility-retry-shell-0'
    const visibility = installVisibilityHarness()
    const host = createHost()
    host.setBuffer(terminalKey, 'recovered snapshot')
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const entry = await runtime.acquire(terminalKey)
      await runtime.attach(entry, document.createElement('div'))
      const readReplay = host.getPtyBuffer
      host.getPtyBuffer = vi.fn()
        .mockRejectedValueOnce(new Error('temporary replay failure'))
        .mockImplementation(readReplay)

      visibility.show(true)

      await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledOnce())
      expect(entry.viewVisible).toBe(true)
      expect(entry.viewNeedsRecovery).toBe(false)
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Visible terminal recovery failed; retrying in 100ms:'),
        expect.any(Error),
      )
    } finally {
      runtime.dispose()
    }
  })

  it('keeps live output enabled when visibility changes during snapshot recovery', async () => {
    const terminalKey = 'T-visibility-race-shell-0'
    const visibility = installVisibilityHarness()
    const host = createHost()
    host.setBuffer(terminalKey, 'initial snapshot')
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    try {
      const entry = await runtime.acquire(terminalKey)
      await runtime.attach(entry, document.createElement('div'))
      const resumeRecovery = host.deferBufferRead(terminalKey)

      visibility.show(true)
      await vi.waitFor(() => expect(entry.terminalReplayRecovery).not.toBeNull())
      visibility.show(false)
      visibility.show(true)
      resumeRecovery()

      await vi.waitFor(() => {
        expect(entry.viewVisible).toBe(true)
        expect(entry.viewNeedsRecovery).toBe(false)
        expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
      })

      host.emit(`pty-model-output-${terminalKey}`, {
        data: btoa('live after recovery'),
        instance_id: 1,
        sequence: 1,
      })
      expect(view.writeLive).toHaveBeenCalledWith({
        data: Uint8Array.from(new TextEncoder().encode('live after recovery')),
        ptyInstanceId: 1,
        sequence: 1,
      })
    } finally {
      runtime.dispose()
    }
  })
})
