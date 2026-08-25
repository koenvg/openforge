import { describe, expect, it, vi } from 'vitest'
import { createTerminalAcquisition } from './terminalAcquisition'
import type { PoolEntry, TerminalRuntimeHost } from './terminalRuntimeTypes'

function createDeferredGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

function createEntry(terminalKey: string): PoolEntry {
  return {
    taskId: terminalKey,
    view: {
      setKeyEventHandler: vi.fn(),
      onUserInput: vi.fn(() => ({ dispose: vi.fn() })),
      bootstrap: vi.fn(),
    },
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    viewSubscriptions: [],
    currentPtyInstance: null,
    terminalStateSource: 'bootstrapping',
    terminalModelSequence: null,
    terminalModelRejectedInstance: null,
    pendingPtyOutput: [],
    pendingTerminalModelOutput: [],
    terminalModelRecovery: null,
    hasOutput: false,
  } as unknown as PoolEntry
}

describe('terminal acquisition', () => {
  it('deduplicates concurrent acquisition through initialization and publishes one entry', async () => {
    const gate = createDeferredGate()
    const pool = new Map<string, PoolEntry>()
    const entry = createEntry('T-1')
    const host = {
      getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: true }),
      listenEvent: vi.fn().mockResolvedValue(vi.fn()),
    } as unknown as TerminalRuntimeHost
    const createEntryForKey = vi.fn(() => entry)
    const acquisition = createTerminalAcquisition({
      host,
      pool,
      createEntry: createEntryForKey,
      preloadEntry: () => gate.promise,
      disposeEntry: vi.fn(),
      resetEntry: vi.fn(),
      lifecycle: {
        applyRestoredPtyInstance: vi.fn(),
        clearTerminal: vi.fn(),
        markPtyExited: vi.fn(),
        markPtyOutput: vi.fn(),
      },
      reconnectReplay: {
        releaseListenerIfIdle: vi.fn(),
        retainListener: vi.fn().mockResolvedValue(undefined),
      },
    })

    const first = acquisition.acquire('T-1')
    const second = acquisition.acquire('T-1')
    gate.release()

    await expect(first).resolves.toBe(entry)
    await expect(second).resolves.toBe(entry)
    expect(createEntryForKey).toHaveBeenCalledOnce()
    expect(pool.get('T-1')).toBe(entry)
    expect(host.listenEvent).toHaveBeenCalledTimes(4)
  })
})
