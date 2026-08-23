import { describe, expect, it, vi } from 'vitest'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import type { PoolEntry } from './terminalRuntimeTypes'

function createEntry(terminalKey: string): PoolEntry {
  return {
    taskId: terminalKey,
    ptyActive: false,
    needsClear: true,
    spawnPending: false,
    currentPtyInstance: null,
    hasOutput: false,
  } as PoolEntry
}

describe('terminal session lifecycle', () => {
  it('applies a restored PTY instance when its terminal entry becomes available', () => {
    const entries = new Map<string, PoolEntry>()
    const lifecycle = createTerminalSessionLifecycle(key => entries.get(key))
    const listener = vi.fn()
    lifecycle.subscribeShellLifecycle('T-1-shell-0', listener)

    lifecycle.restorePtyInstance('T-1-shell-0', 42)

    const entry = createEntry('T-1-shell-0')
    entries.set(entry.taskId, entry)
    lifecycle.applyRestoredPtyInstance(entry)

    expect(entry).toMatchObject({
      ptyActive: true,
      needsClear: false,
      currentPtyInstance: 42,
    })
    expect(listener).toHaveBeenCalledWith({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 42,
      hasOutput: false,
    })
  })

  it('publishes output and exit transitions for a terminal session', () => {
    const entry = createEntry('T-1-shell-0')
    const lifecycle = createTerminalSessionLifecycle(() => entry)
    const listener = vi.fn()
    lifecycle.subscribeShellLifecycle(entry.taskId, listener)

    lifecycle.markPtyOutput(entry)
    lifecycle.markPtyExited(entry)

    expect(listener).toHaveBeenNthCalledWith(1, {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: true,
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: null,
      hasOutput: true,
    })
  })

  it('retains an unmatched restored PTY instance when active sessions are cleared', () => {
    const entries = new Map<string, PoolEntry>()
    const lifecycle = createTerminalSessionLifecycle(key => entries.get(key))
    lifecycle.restorePtyInstance('T-1-shell-0', 42)

    lifecycle.clearAll()

    const entry = createEntry('T-1-shell-0')
    entries.set(entry.taskId, entry)
    lifecycle.applyRestoredPtyInstance(entry)
    expect(entry.currentPtyInstance).toBe(42)
  })
})
