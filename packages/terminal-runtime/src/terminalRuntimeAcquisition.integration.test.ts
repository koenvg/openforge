import {
  createHost,
  imageAddonMocks,
  resetTerminalRuntimeIntegrationHarness,
  terminalMocks,
  webLinkMocks,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_EVENTS_RECONNECTED_EVENT, createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime acquisition', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('passes the owning Terminal Surface key when a web link is activated', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    await runtime.acquire('T-1-shell-2')
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    webLinkMocks.callbacks[0]?.(event, 'https://openforge.dev/docs')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(host.openLink).toHaveBeenCalledWith('T-1-shell-2', 'https://openforge.dev/docs')
  })

  it('uses the configured logger name for runtime diagnostics', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const error = new Error('buffer unavailable')
    host.loggerName = 'terminalPluginPool'
    vi.spyOn(host, 'getPtyBuffer').mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const runtime = createTerminalRuntime(host)
      await runtime.acquire(terminalKey)

      expect(consoleError).toHaveBeenCalledWith(
        '[terminalPluginPool] Failed to get PTY buffer:',
        error,
      )
      runtime.release(terminalKey)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('boots xterm from a Ghostty snapshot and applies only frames after its watermark', async () => {
    const terminalKey = 'T-ghostty-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 7,
      watermark: 1,
      data: btoa('ghostty snapshot'),
    })
    const resumeSnapshot = host.deferTerminalViewSnapshot(terminalKey)
    const runtime = createTerminalRuntime(host)

    const acquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => {
      expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(1)
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 7,
      sequence: 2,
      data: btoa(' later'),
    })
    resumeSnapshot()
    const entry = await acquisition

    expect(entry.terminalStateSource).toBe('ghostty')
    expect(entry.terminalModelSequence).toBe(2)
    expect(getPtyBuffer).not.toHaveBeenCalled()
    const writes = terminalMocks.instances[0].write.mock.calls
    expect(Array.from(writes[0][0] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode('ghostty snapshot')),
    )
    expect(Array.from(writes[1][0] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode(' later')),
    )
  })

  it('forwards only user input from a Ghostty-backed browser replica', async () => {
    const terminalKey = 'T-ghostty-shell-0'
    const host = createHost()
    const writePty = vi.spyOn(host, 'writePty')
    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 7,
      watermark: 0,
      data: '',
    })
    const runtime = createTerminalRuntime(host)

    await runtime.acquire(terminalKey)
    const onData = terminalMocks.instances[0].onData.mock.calls[0][0] as (data: string) => void
    onData('\u001b[?1;2c')
    onData('\u001b[7;9R')
    onData('\u001b[0n')
    onData('\u001b[?25;1$y')
    onData('\u001b[8;24;80t')
    onData('\u001bP1$r0m\u001b\\')
    onData('\u001b]10;rgb:ffff/ffff/ffff\u001b\\')
    onData('user input')
    onData('\u001b[A')

    expect(writePty).toHaveBeenCalledTimes(2)
    expect(writePty).toHaveBeenCalledWith(terminalKey, 'user input')
    expect(writePty).toHaveBeenCalledWith(terminalKey, '\u001b[A')
  })

  it('keeps forwarding xterm protocol replies for legacy sessions', async () => {
    const terminalKey = 'T-legacy-shell-0'
    const host = createHost()
    const writePty = vi.spyOn(host, 'writePty')
    host.setBuffer(terminalKey, '')
    const runtime = createTerminalRuntime(host)

    await runtime.acquire(terminalKey)
    const onData = terminalMocks.instances[0].onData.mock.calls[0][0] as (data: string) => void
    onData('\u001b[?1;2c')

    expect(writePty).toHaveBeenCalledWith(terminalKey, '\u001b[?1;2c')
  })

  it('falls back only the Ghostty replica whose model path is disabled', async () => {
    const failedKey = 'T-failed-shell-0'
    const healthyKey = 'T-healthy-shell-0'
    const host = createHost()
    host.setTerminalViewSnapshot(failedKey, { instanceId: 21, watermark: 0, data: '' })
    host.setTerminalViewSnapshot(healthyKey, { instanceId: 22, watermark: 0, data: '' })
    const runtime = createTerminalRuntime(host)
    const failedEntry = await runtime.acquire(failedKey)
    const healthyEntry = await runtime.acquire(healthyKey)

    host.setBuffer(failedKey, 'legacy fallback')
    host.setTerminalViewSnapshot(failedKey, null)
    host.emit(`pty-model-disabled-${failedKey}`, { instance_id: 21 })

    await vi.waitFor(() => expect(failedEntry.terminalStateSource).toBe('legacy'))
    expect(healthyEntry.terminalStateSource).toBe('ghostty')
    expect(terminalMocks.instances[0].reset).toHaveBeenCalledOnce()
    expect(terminalMocks.instances[0].write).toHaveBeenCalledWith('legacy fallback')
    expect(terminalMocks.instances[1].reset).not.toHaveBeenCalled()
  })

  it('switches a legacy view when a newly created Terminal Session starts publishing model frames', async () => {
    const terminalKey = 'T-late-model-shell-0'
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    expect(entry.terminalStateSource).toBe('legacy')

    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 12,
      watermark: 1,
      data: btoa('model became available'),
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 12,
      sequence: 1,
      data: btoa('model became available'),
    })

    await vi.waitFor(() => {
      expect(entry.terminalStateSource).toBe('ghostty')
      expect(entry.terminalModelSequence).toBe(1)
    })
    expect(terminalMocks.instances[0].reset).toHaveBeenCalledOnce()
  })

  it('recovers Ghostty state when session reattachment races with legacy fallback', async () => {
    const terminalKey = 'T-resumed-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    const writePty = vi.spyOn(host, 'writePty')
    const resumeBufferRead = host.deferBufferRead(terminalKey)
    const runtime = createTerminalRuntime(host)

    const acquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(getPtyBuffer).toHaveBeenCalledOnce())
    runtime.restorePtyInstance(terminalKey, 13)

    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 13,
      watermark: 1,
      data: btoa('resumed agent session'),
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 13,
      sequence: 1,
      data: btoa('resumed agent session'),
    })
    resumeBufferRead()

    const entry = await acquisition

    expect(entry.terminalStateSource).toBe('ghostty')
    expect(entry.currentPtyInstance).toBe(13)

    const onData = terminalMocks.instances[0].onData.mock.calls[0][0] as (data: string) => void
    onData('continue resumed session')

    expect(writePty).toHaveBeenCalledWith(terminalKey, 'continue resumed session')
  })

  it('requests a fresh Ghostty snapshot when a live-frame sequence has a gap', async () => {
    const terminalKey = 'T-gap-shell-0'
    const host = createHost()
    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 9,
      watermark: 1,
      data: btoa('initial state'),
    })
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)

    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 9,
      watermark: 3,
      data: btoa('recovered state'),
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 9,
      sequence: 3,
      data: btoa('gap frame'),
    })

    await vi.waitFor(() => {
      expect(entry.terminalModelRecovery).toBeNull()
      expect(entry.terminalModelSequence).toBe(3)
      expect(entry.terminalStateSource).toBe('ghostty')
      expect(terminalMocks.instances[0].reset).toHaveBeenCalledOnce()
    })
    const writes = terminalMocks.instances[0].write.mock.calls
    expect(Array.from(writes.at(-1)?.[0] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode('recovered state')),
    )
  })

  it('deduplicates concurrent acquisitions for one terminal key', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)

    const [first, second] = await Promise.all([
      runtime.acquire('T-1-shell-0'),
      runtime.acquire('T-1-shell-0'),
    ])

    expect(second).toBe(first)
    expect(terminalMocks.instances).toHaveLength(1)
    expect(imageAddonMocks.instances).toHaveLength(1)
    expect(host.getListenerCount('pty-output-T-1-shell-0')).toBe(1)
    expect(host.getListenerCount('pty-exit-T-1-shell-0')).toBe(1)
  })

  it.each(['pty-output', 'pty-exit'] as const)(
    'rolls back allocated resources and retained listeners when %s setup fails, then retries cleanly',
    async (failedEventPrefix) => {
      const terminalKey = 'T-1-shell-0'
      const outputEvent = `pty-output-${terminalKey}`
      const exitEvent = `pty-exit-${terminalKey}`
      const failedEvent = `${failedEventPrefix}-${terminalKey}`
      const host = createHost()
      host.failNextListenerRegistration(failedEvent)
      const runtime = createTerminalRuntime(host)

      await expect(runtime.acquire(terminalKey)).rejects.toThrow(`listener registration failed: ${failedEvent}`)

      expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
      expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
      expect(runtime.hasTerminal(terminalKey)).toBe(false)
      expect(runtime._getPool().has(terminalKey)).toBe(false)
      expect(host.getListenerCount(outputEvent)).toBe(0)
      expect(host.getListenerCount(exitEvent)).toBe(0)
      expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(0)

      const retriedEntry = await runtime.acquire(terminalKey)

      expect(terminalMocks.instances).toHaveLength(2)
      expect(retriedEntry).toBe(runtime._getPool().get(terminalKey))
      expect(host.getListenerCount(outputEvent)).toBe(1)
      expect(host.getListenerCount(exitEvent)).toBe(1)
      expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
    },
  )

  it('reacquires cleanly after release invalidates initialization before pool registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    const resumeBufferRead = host.deferBufferRead(terminalKey)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(getPtyBuffer).toHaveBeenCalledOnce())

    runtime.release(terminalKey)
    resumeBufferRead()
    const currentAcquisition = runtime.acquire(terminalKey)

    const [releasedEntry, currentEntry] = await Promise.all([releasedAcquisition, currentAcquisition])

    expect(releasedEntry).not.toBe(currentEntry)
    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(1)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(1)
  })

  it('releaseAllForTask invalidates a pending acquisition before pool registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    const resumeBufferRead = host.deferBufferRead(terminalKey)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(getPtyBuffer).toHaveBeenCalledOnce())

    expect(runtime.releaseAllForTask('T-1')).toBe(1)
    resumeBufferRead()
    await releasedAcquisition

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(0)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(0)
  })

  it('does not publish a released entry after final PTY listener registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const listenEvent = vi.spyOn(host, 'listenEvent')
    const resumeExitListenerRegistration = host.deferListenerRegistration(`pty-exit-${terminalKey}`)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledWith(`pty-exit-${terminalKey}`, expect.any(Function))
    })

    resumeExitListenerRegistration()
    // Let listener registration and retention settle, but release before initializeTerminal resumes.
    await Promise.resolve()
    await Promise.resolve()
    runtime.release(terminalKey)

    const releasedEntry = await releasedAcquisition

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(0)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(0)

    const currentEntry = await runtime.acquire(terminalKey)
    expect(currentEntry).not.toBe(releasedEntry)
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
  })

})
