import { regularTerminalSessions } from './terminalSessionService'

export const getShellLifecycleState = regularTerminalSessions.getShellLifecycleState
export const getTaskTerminalTabsSession = regularTerminalSessions.getTaskTerminalTabsSession
export const releaseAllForTask = regularTerminalSessions.releaseAllForTask
