import { describe, expect, it, vi } from 'vitest'
import {
  APP_EVENTS_RECONNECTED_EVENT,
  createTerminalReconnectReplay,
} from './terminalReconnectReplay'
import type { PoolEntry, TerminalRuntimeHost } from './terminalRuntimeTypes'

function createEntry(): PoolEntry {
  return {
    taskId: 'T-1',
    needsClear: false,
    ptyActive: false,
    attached: true,
    view: {
      bootstrap: vi.fn(),
      refresh: vi.fn(),
    },
  } as unknown as PoolEntry
}

describe('terminal reconnect replay', () => {
  it('replays retained output and refreshes an attached terminal view', async () => {
    const entry = createEntry()
    const host = {
      getPtyBuffer: vi.fn().mockResolvedValue({ buffer: 'retained output', isLive: true }),
    } as unknown as TerminalRuntimeHost
    const resetEntry = vi.fn()
    const notifyLifecycle = vi.fn()
    const replay = createTerminalReconnectReplay({
      host,
      getEntries: () => [entry],
      hasEntries: () => true,
      resetEntry,
      notifyLifecycle,
    })

    await replay.replayActiveTerminals()

    expect(resetEntry).toHaveBeenCalledWith(entry)
    expect(entry.view.bootstrap).toHaveBeenCalledWith('retained output')
    expect(entry.view.refresh).toHaveBeenCalledOnce()
    expect(entry).toMatchObject({ ptyActive: true, needsClear: false, hasOutput: true })
    expect(notifyLifecycle).toHaveBeenCalledWith('T-1')
  })

  it('retains one app-event listener and releases it when no terminals remain', async () => {
    let eventHandler: (() => void) | undefined
    const unlisten = vi.fn()
    const host = {
      listenEvent: vi.fn(async (eventName: string, handler: () => void) => {
        expect(eventName).toBe(APP_EVENTS_RECONNECTED_EVENT)
        eventHandler = handler
        return unlisten
      }),
    } as unknown as TerminalRuntimeHost
    let hasEntries = true
    const replay = createTerminalReconnectReplay({
      host,
      getEntries: () => [],
      hasEntries: () => hasEntries,
      resetEntry: vi.fn(),
      notifyLifecycle: vi.fn(),
    })

    await Promise.all([replay.retainListener(), replay.retainListener()])
    eventHandler?.()
    hasEntries = false
    replay.releaseListenerIfIdle()

    expect(host.listenEvent).toHaveBeenCalledTimes(1)
    expect(unlisten).toHaveBeenCalledOnce()
  })
})
