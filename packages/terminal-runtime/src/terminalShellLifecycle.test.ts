import { describe, expect, it, vi } from 'vitest'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import type { PoolEntry } from './terminalRuntimeTypes'

function createEntry(overrides: Partial<PoolEntry> = {}): PoolEntry {
  return {
    ptyActive: false,
    needsClear: false,
    shellExited: false,
    currentPtyInstance: null,
    hasOutput: false,
    ...overrides,
  } as PoolEntry
}

describe('terminal shell lifecycle store', () => {
  it('derives shell state from the current pooled terminal', () => {
    const entries = new Map([[
      'T-1-shell-0',
      createEntry({ ptyActive: false, needsClear: false, shellExited: true, currentPtyInstance: 8, hasOutput: true }),
    ]])
    const store = createTerminalShellLifecycleStore(key => entries.get(key))

    expect(store.getState('T-1-shell-0')).toEqual({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 8,
      hasOutput: true,
    })
    expect(store.getState('missing')).toEqual({
      ptyActive: false,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: false,
    })
  })

  it('notifies subscribers with the latest state and stops after unsubscribe', () => {
    const entry = createEntry()
    const store = createTerminalShellLifecycleStore(() => entry)
    const listener = vi.fn()
    const unsubscribe = store.subscribe('T-1-shell-0', listener)

    entry.ptyActive = true
    entry.needsClear = true
    entry.currentPtyInstance = 3
    store.notify('T-1-shell-0')
    unsubscribe()
    entry.hasOutput = true
    store.notify('T-1-shell-0')

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 3,
      hasOutput: false,
    })
  })
})
