import { createHost } from './terminalRuntimeHost.testSupport'
import {
  createListenerRegistrationFailureSupport,
  imageAddonMocks,
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

describe('terminal runtime reconnect replay', () => {
  beforeEach(resetTerminalRuntimeMocks)

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
    expect(host.getListenerCount(`pty-model-output-${terminalKey}`)).toBe(0)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(1)
  })

  it('rolls back the provisional pool entry when reconnect listener setup fails, then retries cleanly', async () => {
    const terminalKey = 'T-1-shell-0'
    const modelOutputEvent = `pty-model-output-${terminalKey}`
    const exitEvent = `pty-exit-${terminalKey}`
    const listenerRegistrationFailures = createListenerRegistrationFailureSupport()
    const host = createHost({ listenerRegistrationFailures })
    listenerRegistrationFailures.failNext(APP_EVENTS_RECONNECTED_EVENT)
    const runtime = createTerminalRuntime(host)

    await expect(runtime.acquire(terminalKey)).rejects.toThrow(
      `listener registration failed: ${APP_EVENTS_RECONNECTED_EVENT}`,
    )

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(runtime._getPool().has(terminalKey)).toBe(false)
    expect(host.getListenerCount(modelOutputEvent)).toBe(0)
    expect(host.getListenerCount(exitEvent)).toBe(0)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(0)

    const retriedEntry = await runtime.acquire(terminalKey)

    expect(terminalMocks.instances).toHaveLength(2)
    expect(retriedEntry).toBe(runtime._getPool().get(terminalKey))
    expect(host.getListenerCount(modelOutputEvent)).toBe(0)
    expect(host.getListenerCount(exitEvent)).toBe(1)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
  })

  it('rejects a reconnect replay that resolves after PTY replacement', async () => {
    const terminalKey = 'T-replaced-shell-0'
    const host = createHost()
    const replayState = (data: string, instanceId: number) => ({
      buffer: null,
      isLive: true,
      instanceId,
      snapshot: { instanceId, watermark: 0, data: btoa(data) },
    })
    let resolveReplay!: (state: ReturnType<typeof replayState>) => void
    host.getPtyBuffer = vi.fn()
      .mockResolvedValueOnce(replayState('current', 10))
      .mockImplementationOnce(() => new Promise(resolve => { resolveReplay = resolve }))
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    terminalMocks.instances[0].write.mockClear()

    const replay = runtime.replayPtyBuffersForActiveTerminals()
    await vi.waitFor(() => expect(host.getPtyBuffer).toHaveBeenCalledTimes(2))
    const started = runtime.markShellPtyStarted(entry, 11)
    resolveReplay(replayState('stale replay', 10))
    await Promise.all([replay, started])

    expect(entry.currentPtyInstance).toBe(11)
    expect(terminalMocks.instances[0].write).not.toHaveBeenCalled()
  }) // stale reconnect replay
}) // terminal runtime reconnect replay
