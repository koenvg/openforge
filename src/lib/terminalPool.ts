import type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn,
  TerminalTab,
  TerminalViewAttachment,
} from '@openforge-app/terminal-runtime'
import { agentTerminalSessions, getTerminalRuntimeForTests } from './terminalSessionService'

export type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn as DesktopUnlistenFn,
  TerminalTab,
  TerminalViewAttachment,
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'
export const isValidTerminalDimensions = agentTerminalSessions.isValidTerminalDimensions
export const getTerminalImageProtocol = agentTerminalSessions.getTerminalImageProtocol
export const acquire = agentTerminalSessions.acquire
export const attach = agentTerminalSessions.attach
export const detach = agentTerminalSessions.detach
export const release = agentTerminalSessions.release
export const resetTerminal = agentTerminalSessions.resetTerminal
export const shouldSpawnPty = agentTerminalSessions.shouldSpawnPty
export const markPtySpawnPending = agentTerminalSessions.markPtySpawnPending
export const clearPtySpawnPending = agentTerminalSessions.clearPtySpawnPending
export const restorePtyInstance = agentTerminalSessions.restorePtyInstance
export const markShellPtyStarted = agentTerminalSessions.markShellPtyStarted
export const subscribeShellLifecycle = agentTerminalSessions.subscribeShellLifecycle
export const isShellExited = agentTerminalSessions.isShellExited
export const getShellLifecycleState = agentTerminalSessions.getShellLifecycleState
export const updateShellLifecycleState = agentTerminalSessions.updateShellLifecycleState
export const getTaskTerminalTabsSession = agentTerminalSessions.getTaskTerminalTabsSession
export const updateTaskTerminalTabsSession = agentTerminalSessions.updateTaskTerminalTabsSession
export const clearTaskTerminalTabsSession = agentTerminalSessions.clearTaskTerminalTabsSession
export const releaseAll = agentTerminalSessions.releaseAll
export const releaseAllForTask = agentTerminalSessions.releaseAllForTask
export const focusTerminal = agentTerminalSessions.focusTerminal
export const hasTerminal = agentTerminalSessions.hasTerminal
export const isPtyActive = agentTerminalSessions.isPtyActive
export const recoverActiveTerminal = agentTerminalSessions.recoverActiveTerminal
export const replayPtyBuffersForActiveTerminals = agentTerminalSessions.replayPtyBuffersForActiveTerminals
export const _getPool = getTerminalRuntimeForTests()._getPool
