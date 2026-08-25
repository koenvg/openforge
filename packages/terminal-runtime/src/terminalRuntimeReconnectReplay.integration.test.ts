import {
  createHost,
  imageAddonMocks,
  resetTerminalRuntimeIntegrationHarness,
  terminalMocks,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_EVENTS_RECONNECTED_EVENT, createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime reconnect replay', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('reacquires cleanly after release invalidates initialization during reconnect setup', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const resumeReconnectRegistration = host.deferListenerRegistration(APP_EVENTS_RECONNECTED_EVENT)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(runtime.hasTerminal(terminalKey)).toBe(true))

    runtime.release(terminalKey)
    const currentAcquisition = runtime.acquire(terminalKey)
    resumeReconnectRegistration()

    const [releasedEntry, currentEntry] = await Promise.all([releasedAcquisition, currentAcquisition])

    expect(releasedEntry).not.toBe(currentEntry)
    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(1)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(1)
  })

  it('rolls back the provisional pool entry when reconnect listener setup fails, then retries cleanly', async () => {
    const terminalKey = 'T-1-shell-0'
    const outputEvent = `pty-output-${terminalKey}`
    const exitEvent = `pty-exit-${terminalKey}`
    const host = createHost()
    host.failNextListenerRegistration(APP_EVENTS_RECONNECTED_EVENT)
    const runtime = createTerminalRuntime(host)

    await expect(runtime.acquire(terminalKey)).rejects.toThrow(
      `listener registration failed: ${APP_EVENTS_RECONNECTED_EVENT}`,
    )

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
  })

  it('rejects a reconnect replay that resolves after PTY replacement', async () => {
    const terminalKey = 'T-replaced-shell-0'
    const host = createHost()
    let resolveReplay!: (state: { buffer: string | null; isLive: boolean; instanceId: number | null }) => void
    host.getPtyBuffer = vi.fn()
      .mockResolvedValueOnce({ buffer: 'current', isLive: true, instanceId: 10 })
      .mockImplementationOnce(() => new Promise(resolve => { resolveReplay = resolve }))
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    terminalMocks.instances[0].write.mockClear()

    const replay = runtime.replayPtyBuffersForActiveTerminals()
    await vi.waitFor(() => expect(host.getPtyBuffer).toHaveBeenCalledTimes(2))
    runtime.markShellPtyStarted(entry, 11)
    resolveReplay({ buffer: 'stale replay', isLive: true, instanceId: 10 })
    await replay

    expect(entry.authority?.ptyInstanceId).toBe(11)
    expect(terminalMocks.instances[0].write).not.toHaveBeenCalled()
  }) // stale reconnect replay
}) // terminal runtime reconnect replay
