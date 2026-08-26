import type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn,
  TerminalSessionClient,
  TerminalTab,
} from '@openforge-app/terminal-runtime'

let terminalSessions: TerminalSessionClient | null = null

export type {
  PoolEntry,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn as OpenForgeEventUnlistenFn,
  TerminalTab,
}

export function configureTerminalSessionClient(client: TerminalSessionClient): void {
  terminalSessions = client
}

function client(): TerminalSessionClient {
  if (!terminalSessions) {
    throw new Error('[terminal plugin] Host Terminal Session Service is not configured')
  }
  return terminalSessions
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'
export function isValidTerminalDimensions(...args: Parameters<TerminalSessionClient['isValidTerminalDimensions']>) { return client().isValidTerminalDimensions(...args) }
export function getTerminalImageProtocol(...args: Parameters<TerminalSessionClient['getTerminalImageProtocol']>) { return client().getTerminalImageProtocol(...args) }
export function acquire(...args: Parameters<TerminalSessionClient['acquire']>) { return client().acquire(...args) }
export function attach(...args: Parameters<TerminalSessionClient['attach']>) { return client().attach(...args) }
export function detach(...args: Parameters<TerminalSessionClient['detach']>) { return client().detach(...args) }
export function release(...args: Parameters<TerminalSessionClient['release']>) { return client().release(...args) }
export function resetTerminal(...args: Parameters<TerminalSessionClient['resetTerminal']>) { return client().resetTerminal(...args) }
export function shouldSpawnPty(...args: Parameters<TerminalSessionClient['shouldSpawnPty']>) { return client().shouldSpawnPty(...args) }
export function markPtySpawnPending(...args: Parameters<TerminalSessionClient['markPtySpawnPending']>) { return client().markPtySpawnPending(...args) }
export function clearPtySpawnPending(...args: Parameters<TerminalSessionClient['clearPtySpawnPending']>) { return client().clearPtySpawnPending(...args) }
export function restorePtyInstance(...args: Parameters<TerminalSessionClient['restorePtyInstance']>) { return client().restorePtyInstance(...args) }
export function markShellPtyStarted(...args: Parameters<TerminalSessionClient['markShellPtyStarted']>) { return client().markShellPtyStarted(...args) }
export function subscribeShellLifecycle(...args: Parameters<TerminalSessionClient['subscribeShellLifecycle']>) { return client().subscribeShellLifecycle(...args) }
export function isShellExited(...args: Parameters<TerminalSessionClient['isShellExited']>) { return client().isShellExited(...args) }
export function getShellLifecycleState(...args: Parameters<TerminalSessionClient['getShellLifecycleState']>) { return client().getShellLifecycleState(...args) }
export function updateShellLifecycleState(...args: Parameters<TerminalSessionClient['updateShellLifecycleState']>) { return client().updateShellLifecycleState(...args) }
export function getTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['getTaskTerminalTabsSession']>) { return client().getTaskTerminalTabsSession(...args) }
export function updateTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['updateTaskTerminalTabsSession']>) { return client().updateTaskTerminalTabsSession(...args) }
export function clearTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['clearTaskTerminalTabsSession']>) { return client().clearTaskTerminalTabsSession(...args) }
export function releaseAll(...args: Parameters<TerminalSessionClient['releaseAll']>) { return client().releaseAll(...args) }
export function releaseAllForTask(...args: Parameters<TerminalSessionClient['releaseAllForTask']>) { return client().releaseAllForTask(...args) }
export function focusTerminal(...args: Parameters<TerminalSessionClient['focusTerminal']>) { return client().focusTerminal(...args) }
export function hasTerminal(...args: Parameters<TerminalSessionClient['hasTerminal']>) { return client().hasTerminal(...args) }
export function isPtyActive(...args: Parameters<TerminalSessionClient['isPtyActive']>) { return client().isPtyActive(...args) }
export function recoverActiveTerminal(...args: Parameters<TerminalSessionClient['recoverActiveTerminal']>) { return client().recoverActiveTerminal(...args) }
export function replayPtyBuffersForActiveTerminals(...args: Parameters<TerminalSessionClient['replayPtyBuffersForActiveTerminals']>) { return client().replayPtyBuffersForActiveTerminals(...args) }
