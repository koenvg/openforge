import { describe, expect, it, vi } from 'vitest'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import type { ShellLifecycleState } from './terminalRuntimeTypes'

const inactive: ShellLifecycleState = {
  ptyActive: false,
  shellExited: false,
  currentPtyInstance: null,
  hasOutput: false,
}

describe('terminal shell lifecycle store', () => {
  it('reads shell state from the current coordinated Terminal Session', () => {
    const states = new Map<string, ShellLifecycleState>([[
      'T-1-shell-0',
      { ptyActive: false, shellExited: true, currentPtyInstance: 8, hasOutput: true },
    ]])
    const store = createTerminalShellLifecycleStore(key => states.get(key))

    expect(store.getState('T-1-shell-0')).toEqual({
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 8,
      hasOutput: true,
    })
    expect(store.getState('missing')).toEqual(inactive)
  })

  it('notifies subscribers with the latest state and stops after unsubscribe', () => {
    let state = inactive
    const store = createTerminalShellLifecycleStore(() => state)
    const listener = vi.fn()
    const unsubscribe = store.subscribe('T-1-shell-0', listener)

    state = { ptyActive: true, shellExited: false, currentPtyInstance: 3, hasOutput: false }
    store.notify('T-1-shell-0')
    unsubscribe()
    state = { ...state, hasOutput: true }
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
