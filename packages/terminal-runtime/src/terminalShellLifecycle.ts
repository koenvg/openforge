import type {
  ShellLifecycleListener,
  ShellLifecycleState,
  TerminalRuntimeUnlistenFn,
} from './terminalRuntimeTypes'

const inactiveShellLifecycle: ShellLifecycleState = {
  ptyActive: false,
  shellExited: false,
  currentPtyInstance: null,
  hasOutput: false,
}

export function createTerminalShellLifecycleStore(
  getStateForSession: (shellSessionKey: string) => ShellLifecycleState | undefined,
) {
  const listenersByTerminal = new Map<string, Set<ShellLifecycleListener>>()

  function getState(shellSessionKey: string): ShellLifecycleState {
    return getStateForSession(shellSessionKey) ?? inactiveShellLifecycle
  }

  function notify(shellSessionKey: string): void {
    const listeners = listenersByTerminal.get(shellSessionKey)
    if (!listeners || listeners.size === 0) return
    const state = getState(shellSessionKey)
    for (const listener of listeners) listener(state)
  }

  function subscribe(
    shellSessionKey: string,
    listener: ShellLifecycleListener,
  ): TerminalRuntimeUnlistenFn {
    let listeners = listenersByTerminal.get(shellSessionKey)
    if (!listeners) {
      listeners = new Set()
      listenersByTerminal.set(shellSessionKey, listeners)
    }
    listeners.add(listener)

    return () => {
      const current = listenersByTerminal.get(shellSessionKey)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listenersByTerminal.delete(shellSessionKey)
    }
  }

  function clear(shellSessionKey: string): void {
    listenersByTerminal.delete(shellSessionKey)
  }

  function clearAll(): void {
    listenersByTerminal.clear()
  }

  return { getState, notify, subscribe, clear, clearAll }
}
