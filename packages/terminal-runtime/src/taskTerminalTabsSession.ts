import { createIndexedShellSessionKey } from './ptySessionKey'
import type { TaskTerminalTabsSession } from './terminalRuntimeTypes'

function createDefaultTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
  return {
    tabs: [{
      index: 0,
      key: createIndexedShellSessionKey({ taskId, terminalIndex: 0 }),
      label: 'Shell 1',
    }],
    activeTabIndex: 0,
    nextIndex: 1,
  }
}

export function createTaskTerminalTabsSessionStore() {
  const sessions = new Map<string, TaskTerminalTabsSession>()

  function get(taskId: string): TaskTerminalTabsSession {
    const existing = sessions.get(taskId)
    if (existing) return existing

    const session = createDefaultTaskTerminalTabsSession(taskId)
    sessions.set(taskId, session)
    return session
  }

  function update(taskId: string, session: TaskTerminalTabsSession): void {
    sessions.set(taskId, session)
  }

  function clear(taskId: string): void {
    sessions.delete(taskId)
  }

  function clearAll(): void {
    sessions.clear()
  }

  return { get, update, clear, clearAll }
}
