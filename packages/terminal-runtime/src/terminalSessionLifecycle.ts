import { createTaskTerminalTabsSessionStore } from './taskTerminalTabsSession'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import type { PoolEntry, ShellLifecycleState, TaskTerminalTabsSession } from './terminalRuntimeTypes'

export function createTerminalSessionLifecycle(
  getEntry: (terminalKey: string) => PoolEntry | undefined,
) {
  const pendingPtyInstances = new Map<string, number>()
  const taskTabSessions = createTaskTerminalTabsSessionStore()
  const shellLifecycle = createTerminalShellLifecycleStore(getEntry)

  function markPtyStarted(entry: PoolEntry, instanceId: number): void {
    entry.currentPtyInstance = instanceId
    entry.ptyActive = true
    entry.needsClear = false
    shellLifecycle.notify(entry.taskId)
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
    const restoredPtyInstance = pendingPtyInstances.get(entry.taskId)
    if (restoredPtyInstance === undefined) return
    pendingPtyInstances.delete(entry.taskId)
    markPtyStarted(entry, restoredPtyInstance)
  }

  function markPtyOutput(entry: PoolEntry): void {
    entry.ptyActive = true
    entry.hasOutput = true
    shellLifecycle.notify(entry.taskId)
  }

  function markPtyExited(entry: PoolEntry): void {
    entry.ptyActive = false
    entry.needsClear = true
    shellLifecycle.notify(entry.taskId)
  }

  function shouldSpawnPty(entry: PoolEntry): boolean {
    return !entry.ptyActive && !entry.spawnPending && !entry.needsClear
  }

  function markPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = true
    entry.hasOutput = false
  }

  function clearPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = false
  }

  function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
    entry.currentPtyInstance = instanceId
  }

  function isShellExited(terminalKey: string): boolean {
    const entry = getEntry(terminalKey)
    return entry ? !entry.ptyActive && entry.needsClear : false
  }

  function updateShellLifecycleState(terminalKey: string, state: ShellLifecycleState): void {
    const entry = getEntry(terminalKey)
    if (!entry) return
    entry.ptyActive = state.ptyActive
    entry.needsClear = state.shellExited
    entry.currentPtyInstance = state.currentPtyInstance
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
    setCurrentPtyInstance,
    shouldSpawnPty,
    subscribeShellLifecycle: shellLifecycle.subscribe,
    updateShellLifecycleState,
    updateTaskTerminalTabsSession,
  }
}
