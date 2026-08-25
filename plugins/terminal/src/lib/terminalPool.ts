import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  createTerminalRuntime,
  type PoolEntry,
  type ShellLifecycleState,
  type TaskTerminalTabsSession,
  type TerminalRuntimeUnlistenFn,
  type TerminalTab,
} from '@openforge-app/terminal-runtime'
import {
  getPtyBuffer,
  listenOpenForgeEvent,
  openTerminalLink,
  resizePty,
  writePty,
  writeTerminalQueryResponse,
} from './ipc'
import { themeMode } from './theme'

const terminalRuntime = createTerminalRuntime({
  listenEvent: listenOpenForgeEvent,
  getPtyBuffer,
  writePty,
  writeTerminalQueryResponse,
  resizePty,
  openLink: openTerminalLink,
  themeMode,
  loggerName: 'terminalPluginPool',
}, { authority: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT })

export type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn as OpenForgeEventUnlistenFn,
  TerminalTab,
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'
export const isValidTerminalDimensions = terminalRuntime.isValidTerminalDimensions
export const getTerminalImageProtocol = terminalRuntime.getTerminalImageProtocol
export const acquire = terminalRuntime.acquire
export const attach = terminalRuntime.attach
export const detach = terminalRuntime.detach
export const release = terminalRuntime.release
export const resetTerminal = terminalRuntime.resetTerminal
export const shouldSpawnPty = terminalRuntime.shouldSpawnPty
export const markPtySpawnPending = terminalRuntime.markPtySpawnPending
export const clearPtySpawnPending = terminalRuntime.clearPtySpawnPending
export const markShellPtyStarted = terminalRuntime.markShellPtyStarted
export const subscribeShellLifecycle = terminalRuntime.subscribeShellLifecycle
export const isShellExited = terminalRuntime.isShellExited
export const getShellLifecycleState = terminalRuntime.getShellLifecycleState
export const updateShellLifecycleState = terminalRuntime.updateShellLifecycleState
export const getTaskTerminalTabsSession = terminalRuntime.getTaskTerminalTabsSession
export const updateTaskTerminalTabsSession = terminalRuntime.updateTaskTerminalTabsSession
export const clearTaskTerminalTabsSession = terminalRuntime.clearTaskTerminalTabsSession
export const releaseAll = terminalRuntime.releaseAll
export const releaseAllForTask = terminalRuntime.releaseAllForTask
export const focusTerminal = terminalRuntime.focusTerminal
export const isPtyActive = terminalRuntime.isPtyActive
export const recoverActiveTerminal = terminalRuntime.recoverActiveTerminal
export const replayPtyBuffersForActiveTerminals = terminalRuntime.replayPtyBuffersForActiveTerminals
export const _getPool = terminalRuntime._getPool
