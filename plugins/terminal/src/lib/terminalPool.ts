import type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalPtySpawnLease,
  TerminalRuntimeUnlistenFn,
  TerminalSession,
  TerminalSessionClient,
  TerminalTab,
  TerminalViewAttachment,
} from '@openforge-app/terminal-runtime'

let terminalSessions: TerminalSessionClient | null = null

export type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalPtySpawnLease,
  TerminalRuntimeUnlistenFn as OpenForgeEventUnlistenFn,
  TerminalSession,
  TerminalTab,
  TerminalViewAttachment,
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
export function acquire(...args: Parameters<TerminalSessionClient['acquire']>) { return client().acquire(...args) }
export function attach(...args: Parameters<TerminalSessionClient['attach']>) { return client().attach(...args) }
export function beginPtySpawn(...args: Parameters<TerminalSessionClient['beginPtySpawn']>) { return client().beginPtySpawn(...args) }
export function markPerformancePhase(...args: Parameters<TerminalSessionClient['markPerformancePhase']>) { return client().markPerformancePhase(...args) }
export function release(...args: Parameters<TerminalSessionClient['release']>) { return client().release(...args) }
export function resetPresentation(...args: Parameters<TerminalSessionClient['resetPresentation']>) { return client().resetPresentation(...args) }
export function restorePtyInstance(...args: Parameters<TerminalSessionClient['restorePtyInstance']>) { return client().restorePtyInstance(...args) }
export function subscribeShellLifecycle(...args: Parameters<TerminalSessionClient['subscribeShellLifecycle']>) { return client().subscribeShellLifecycle(...args) }
export function isShellExited(...args: Parameters<TerminalSessionClient['isShellExited']>) { return client().isShellExited(...args) }
export function getShellLifecycleState(...args: Parameters<TerminalSessionClient['getShellLifecycleState']>) { return client().getShellLifecycleState(...args) }
export function getTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['getTaskTerminalTabsSession']>) { return client().getTaskTerminalTabsSession(...args) }
export function updateTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['updateTaskTerminalTabsSession']>) { return client().updateTaskTerminalTabsSession(...args) }
export function clearTaskTerminalTabsSession(...args: Parameters<TerminalSessionClient['clearTaskTerminalTabsSession']>) { return client().clearTaskTerminalTabsSession(...args) }
export function releaseAll(...args: Parameters<TerminalSessionClient['releaseAll']>) { return client().releaseAll(...args) }
export function releaseAllForTask(...args: Parameters<TerminalSessionClient['releaseAllForTask']>) { return client().releaseAllForTask(...args) }
export function focusTerminal(...args: Parameters<TerminalSessionClient['focusTerminal']>) { return client().focusTerminal(...args) }
export function hasTerminal(...args: Parameters<TerminalSessionClient['hasTerminal']>) { return client().hasTerminal(...args) }
export function isPtyActive(...args: Parameters<TerminalSessionClient['isPtyActive']>) { return client().isPtyActive(...args) }
export function replayPtyBuffersForActiveTerminals(...args: Parameters<TerminalSessionClient['replayPtyBuffersForActiveTerminals']>) { return client().replayPtyBuffersForActiveTerminals(...args) }
