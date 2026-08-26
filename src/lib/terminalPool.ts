import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  createTerminalRuntime,
  parsePtySessionKey,
  type PoolEntry,
  type ShellLifecycleState,
  type TaskTerminalTabsSession,
  type TerminalTab,
} from '@openforge-app/terminal-runtime'
import { listenDesktopEvent, type DesktopUnlistenFn } from './desktopIpc'
import type { TerminalDesktopEventName } from './desktopIpcContract'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import { getPtyBuffer, resizePty, writePty, writeTerminalQueryResponse } from './ipc'
import { taskLinkRouter } from './plugin/taskLinks'
import { themeMode } from './theme'

const transport = createDesktopTerminalTransport({
  listenEvent: (eventName, handler) => listenDesktopEvent(
    eventName as TerminalDesktopEventName,
    handler,
  ),
  getPtyBuffer,
  writeTerminalQueryResponse,
  writePty,
  resizePty,
})

const terminalRuntime = createTerminalRuntime({
  transport,
  environment: {
    openLink: (terminalKey, url) => taskLinkRouter.open({
      taskId: parsePtySessionKey(terminalKey).taskId,
      url,
    }),
    themeMode,
    loggerName: 'terminalPool',
  },
  authority: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
})

export type {
  DesktopUnlistenFn,
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
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
export const restorePtyInstance = terminalRuntime.restorePtyInstance
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
export const hasTerminal = terminalRuntime.hasTerminal
export const isPtyActive = terminalRuntime.isPtyActive
export const recoverActiveTerminal = terminalRuntime.recoverActiveTerminal
export const replayPtyBuffersForActiveTerminals = terminalRuntime.replayPtyBuffersForActiveTerminals
export const _getPool = terminalRuntime._getPool
