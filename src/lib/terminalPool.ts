import {
  createTerminalRuntime,
  type PoolEntry,
  type ShellLifecycleState,
  type TaskTerminalTabsSession,
  type TerminalRuntimeUnlistenFn,
  type TerminalTab,
} from '@openforge/terminal-runtime'
import { listenDesktopEvent } from './desktopIpc'
import { getPtyBuffer, openUrl, resizePty, writePty } from './ipc'
import { themeMode } from './theme'

const terminalRuntime = createTerminalRuntime({
  listenEvent: listenDesktopEvent,
  getPtyBuffer,
  writePty,
  resizePty,
  openUrl,
  themeMode,
  loggerName: 'terminalPool',
})

export type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn as DesktopUnlistenFn,
  TerminalTab,
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'
export const isValidTerminalDimensions = terminalRuntime.isValidTerminalDimensions
export const acquire = terminalRuntime.acquire
export const attach = terminalRuntime.attach
export const detach = terminalRuntime.detach
export const release = terminalRuntime.release
export const shouldSpawnPty = terminalRuntime.shouldSpawnPty
export const markPtySpawnPending = terminalRuntime.markPtySpawnPending
export const clearPtySpawnPending = terminalRuntime.clearPtySpawnPending
export const setCurrentPtyInstance = terminalRuntime.setCurrentPtyInstance
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
