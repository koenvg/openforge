import type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalPtySpawnLease,
  TerminalRuntimeDiagnostics,
  TerminalRuntimeUnlistenFn,
  TerminalSession,
  TerminalTab,
  TerminalViewAttachment,
} from '@openforge-app/terminal-runtime'
import { agentTerminalSessions, getTerminalRuntimeForTests } from './terminalSessionService'

export type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalPtySpawnLease,
  TerminalRuntimeDiagnostics,
  TerminalRuntimeUnlistenFn as DesktopUnlistenFn,
  TerminalSession,
  TerminalTab,
  TerminalViewAttachment,
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'
export const isValidTerminalDimensions = agentTerminalSessions.isValidTerminalDimensions
export const acquire = agentTerminalSessions.acquire
export const attach = agentTerminalSessions.attach
export const beginPtySpawn = agentTerminalSessions.beginPtySpawn
export const markPerformancePhase = agentTerminalSessions.markPerformancePhase
export const release = agentTerminalSessions.release
export const resetPresentation = agentTerminalSessions.resetPresentation
export const restorePtyInstance = agentTerminalSessions.restorePtyInstance
export const subscribeShellLifecycle = agentTerminalSessions.subscribeShellLifecycle
export const isShellExited = agentTerminalSessions.isShellExited
export const getShellLifecycleState = agentTerminalSessions.getShellLifecycleState
export const getTaskTerminalTabsSession = agentTerminalSessions.getTaskTerminalTabsSession
export const updateTaskTerminalTabsSession = agentTerminalSessions.updateTaskTerminalTabsSession
export const clearTaskTerminalTabsSession = agentTerminalSessions.clearTaskTerminalTabsSession
export const releaseAll = agentTerminalSessions.releaseAll
export const releaseAllForTask = agentTerminalSessions.releaseAllForTask
export const focusTerminal = agentTerminalSessions.focusTerminal
export const hasTerminal = agentTerminalSessions.hasTerminal
export const isPtyActive = agentTerminalSessions.isPtyActive
export const replayPtyBuffersForActiveTerminals = agentTerminalSessions.replayPtyBuffersForActiveTerminals
export const terminalDiagnostics = getTerminalRuntimeForTests().diagnostics
