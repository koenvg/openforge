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

  it('uses PTY byte replay and never accepts a sidecar snapshot as xterm state', async () => {
    const terminalKey = 'T-xterm-shell-0'
    const host = createHost()
    const getTerminalViewSnapshot = vi.spyOn(host, 'getTerminalViewSnapshot')
    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 6,
      watermark: 99,
      data: btoa('stale sidecar snapshot'),
    })
    host.getPtyBuffer = async () => ({ buffer: 'xterm replay', isLive: true, instanceId: 7 })
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire(terminalKey)

    expect(entry.terminalStateSource).toBe('pty-byte-replay')
    expect(entry.authority?.ptyInstanceId).toBe(7)
    expect(getTerminalViewSnapshot).not.toHaveBeenCalled()
    expect(terminalMocks.instances[0].write).toHaveBeenCalledWith('xterm replay', expect.any(Function))
  })


  it('keeps xterm authoritative when the diagnostic model fails', async () => {
    const terminalKey = 'T-failed-shell-0'
    const host = createHost()
    host.getPtyBuffer = async () => ({ buffer: 'initial', isLive: true, instanceId: 21 })
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)

    host.emit(`pty-model-disabled-${terminalKey}`, { instance_id: 21 })
    host.emit(`pty-output-${terminalKey}`, {
      data: ' after failure',
      instance_id: 21,
      shell_session_key: terminalKey,
    })

    expect(entry.terminalStateSource).toBe('pty-byte-replay')
    expect(terminalMocks.instances[0].reset).not.toHaveBeenCalled()
    expect(terminalMocks.instances[0].write).toHaveBeenNthCalledWith(1, 'initial', expect.any(Function))
    expect(terminalMocks.instances[0].write).toHaveBeenNthCalledWith(2, ' after failure', expect.any(Function))
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
