import { createTaskTerminalTabsSessionStore } from './taskTerminalTabsSession'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import type { PoolEntry, ShellLifecycleState, TaskTerminalTabsSession } from './terminalRuntimeTypes'

export function createTerminalSessionLifecycle(getEntry: (terminalKey: string) => PoolEntry | undefined) {
  const pendingPtyInstances = new Map<string, number>()
  const taskTabSessions = createTaskTerminalTabsSessionStore()
  const shellLifecycle = createTerminalShellLifecycleStore(getEntry)

  function markPtyStarted(entry: PoolEntry, instanceId: number): void {
    setCurrentPtyInstance(entry, instanceId)
    entry.spawnPending = false
    entry.ptyActive = true
    entry.shellExited = false
    entry.needsClear = false
    shellLifecycle.notify(entry.shellSessionKey)
  }

  function restorePtyInstance(terminalKey: string, instanceId: number): void {
    const entry = getEntry(terminalKey)
    if (!entry) {
      pendingPtyInstances.set(terminalKey, instanceId)
      return
    }
    markPtyStarted(entry, instanceId)
  }

  function applyRestoredPtyInstance(entry: PoolEntry): void {
    const restoredPtyInstance = pendingPtyInstances.get(entry.shellSessionKey)
    if (restoredPtyInstance === undefined) return
    pendingPtyInstances.delete(entry.shellSessionKey)
    if (entry.ptyActive && entry.currentPtyInstance !== null) return
    markPtyStarted(entry, restoredPtyInstance)
  }

  function markPtyOutput(entry: PoolEntry): void {
    entry.ptyActive = true
    entry.shellExited = false
    entry.hasOutput = true
    shellLifecycle.notify(entry.shellSessionKey)
  }

  function markPtyExited(entry: PoolEntry): void {
    entry.ptyActive = false
    entry.shellExited = true
    entry.needsClear = true
    shellLifecycle.notify(entry.shellSessionKey)
  }

  function shouldSpawnPty(entry: PoolEntry): boolean {
    return !entry.ptyActive && !entry.spawnPending && !entry.shellExited
  }

  function markPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = true
    entry.hasOutput = false
  }

  function clearPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = false
  }

  function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
    if (entry.currentPtyInstance !== instanceId) entry.outputSequence = 0
    entry.currentPtyInstance = instanceId
  }

  function isShellExited(terminalKey: string): boolean {
    const entry = getEntry(terminalKey)
    return entry?.shellExited ?? false
  }

  function updateShellLifecycleState(terminalKey: string, state: ShellLifecycleState): void {
    const entry = getEntry(terminalKey)
    if (!entry) return
    entry.ptyActive = state.ptyActive
    entry.shellExited = state.shellExited
    setCurrentPtyInstance(entry, state.currentPtyInstance)
    entry.hasOutput = state.hasOutput
    shellLifecycle.notify(terminalKey)
  }

  function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
    return taskTabSessions.get(taskId)
  }

  function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
    taskTabSessions.update(taskId, session)
  }

  function clearTerminal(terminalKey: string): void {
    pendingPtyInstances.delete(terminalKey)
    shellLifecycle.clear(terminalKey)
  }

  function clearTaskTerminalTabsSession(taskId: string): void {
    taskTabSessions.clear(taskId)
  }

  function clearAll(): void {
    taskTabSessions.clearAll()
    shellLifecycle.clearAll()
  }

  return {
    applyRestoredPtyInstance,
    clearAll,
    clearPtySpawnPending,
    clearTaskTerminalTabsSession,
    clearTerminal,
    getShellLifecycleState: shellLifecycle.getState,
    getTaskTerminalTabsSession,
    isShellExited,
    markPtyExited,
    markPtyOutput,
    markPtySpawnPending,
    markPtyStarted,
    notifyShellLifecycle: shellLifecycle.notify,
    restorePtyInstance,
    shouldSpawnPty,
    subscribeShellLifecycle: shellLifecycle.subscribe,
    updateShellLifecycleState,
    updateTaskTerminalTabsSession,
  }
}
