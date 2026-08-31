import { createTaskTerminalTabsSessionStore } from './taskTerminalTabsSession'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import type { TaskTerminalTabsSession } from './terminalRuntimeTypes'

export function createTerminalSessionLifecycle(
  getCoordinator: (shellSessionKey: string) => TerminalSessionCoordinator | undefined,
) {
  const pendingPtyInstances = new Map<string, number>()
  const taskTabSessions = createTaskTerminalTabsSessionStore()
  const shellLifecycle = createTerminalShellLifecycleStore(
    shellSessionKey => getCoordinator(shellSessionKey)?.getLifecycleState(),
  )

  async function restorePtyInstance(shellSessionKey: string, instanceId: number): Promise<void> {
    const coordinator = getCoordinator(shellSessionKey)
    if (!coordinator) {
      pendingPtyInstances.set(shellSessionKey, instanceId)
      return
    }
    await coordinator.restorePtyInstance(instanceId)
  }

  async function applyRestoredPtyInstance(
    coordinator: TerminalSessionCoordinator,
  ): Promise<void> {
    const shellSessionKey = coordinator.session.shellSessionKey
    const restoredPtyInstance = pendingPtyInstances.get(shellSessionKey)
    if (restoredPtyInstance === undefined) return
    pendingPtyInstances.delete(shellSessionKey)
    await coordinator.applyPendingRestoredPtyInstance(restoredPtyInstance)
  }

  function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
    return taskTabSessions.get(taskId)
  }

  function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
    taskTabSessions.update(taskId, session)
  }

  function clearTerminal(shellSessionKey: string): void {
    pendingPtyInstances.delete(shellSessionKey)
    shellLifecycle.clear(shellSessionKey)
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
    clearTaskTerminalTabsSession,
    clearTerminal,
    getShellLifecycleState: shellLifecycle.getState,
    getTaskTerminalTabsSession,
    isShellExited: (shellSessionKey: string) => getCoordinator(shellSessionKey)?.isShellExited() ?? false,
    notifyShellLifecycle: shellLifecycle.notify,
    restorePtyInstance,
    subscribeShellLifecycle: shellLifecycle.subscribe,
    updateTaskTerminalTabsSession,
  }
}
