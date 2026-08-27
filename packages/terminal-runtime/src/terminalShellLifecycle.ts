import type {
  PoolEntry,
  ShellLifecycleListener,
  ShellLifecycleState,
  TerminalRuntimeUnlistenFn,
} from './terminalRuntimeTypes'

function getStateFromEntry(entry: PoolEntry | undefined): ShellLifecycleState {
  return {
    ptyActive: entry?.ptyActive ?? false,
    shellExited: entry?.shellExited ?? false,
    currentPtyInstance: entry?.currentPtyInstance ?? null,
    hasOutput: entry?.hasOutput ?? false,
  }
}

export function createTerminalShellLifecycleStore(getEntry: (terminalKey: string) => PoolEntry | undefined) {
  const listenersByTerminal = new Map<string, Set<ShellLifecycleListener>>()

  function getState(terminalKey: string): ShellLifecycleState {
    return getStateFromEntry(getEntry(terminalKey))
  }

  function notify(terminalKey: string): void {
    const listeners = listenersByTerminal.get(terminalKey)
    if (!listeners || listeners.size === 0) return

    const state = getState(terminalKey)
    for (const listener of listeners) listener(state)
  }

  function subscribe(terminalKey: string, listener: ShellLifecycleListener): TerminalRuntimeUnlistenFn {
    let listeners = listenersByTerminal.get(terminalKey)
    if (!listeners) {
      listeners = new Set()
      listenersByTerminal.set(terminalKey, listeners)
    }
    listeners.add(listener)

    return () => {
      const current = listenersByTerminal.get(terminalKey)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listenersByTerminal.delete(terminalKey)
    }
  }

  function clear(terminalKey: string): void {
    listenersByTerminal.delete(terminalKey)
  }

  function clearAll(): void {
    listenersByTerminal.clear()
  }

  return { getState, notify, subscribe, clear, clearAll }
}
