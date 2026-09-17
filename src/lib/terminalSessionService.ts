import { derived } from 'svelte/store'
import {
  createTerminalRuntime,
  createTerminalSessionService,
  type TerminalPerformanceTrace,
  type TerminalRuntimeEnvironment,
} from '@openforge-app/terminal-runtime'
import { listenDesktopEvent } from './desktopIpc'
import type { TerminalDesktopEventName } from './desktopIpcContract'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import { desktopRestartTerminalControl as restartTerminalControl } from './desktopRestartTerminalControl'
import {
  checkpointTerminalAcquisition,
  checkpointTerminalAuthorityRead,
} from './terminalE2eRuntime'
import { openUrl } from './ipc'
import { terminalFontFamily } from './terminalFont'
import { terminalFontSize } from './terminalFontSize'
import { selectedTheme } from './theme'
import { createTerminalThemeSnapshot } from './terminalThemePresentation'

export const reconcileRestartTerminalInventory = restartTerminalControl.reconcile

const transport = createDesktopTerminalTransport({
  listenEvent: (eventName, handler) => listenDesktopEvent(
    eventName as TerminalDesktopEventName,
    handler,
  ),
  getPtyBuffer: restartTerminalControl.getPtyBuffer,
  writePty: restartTerminalControl.writePty,
  resizePty: restartTerminalControl.resizePty,
}, {
  afterReadReplay: checkpointTerminalAuthorityRead,
  beforeConnectionRestored: restartTerminalControl.reconnect,
})

const terminalThemePresentation = derived(selectedTheme, createTerminalThemeSnapshot)

const terminalRuntimeEnvironment: TerminalRuntimeEnvironment = {
  sampleSessionConfiguration: () => ({ renderer: 'xterm' }),
  openLink: url => openUrl(url),
  themePresentation: terminalThemePresentation,
  fontFamily: terminalFontFamily,
  fontSize: terminalFontSize,
  loggerName: 'terminalSessionService',
}

const terminalRuntime = createTerminalRuntime({
  transport,
  environment: terminalRuntimeEnvironment,
  beforeSessionStart: checkpointTerminalAcquisition,
})

export function configureTerminalPerformanceTrace(trace: TerminalPerformanceTrace | undefined): void {
  terminalRuntimeEnvironment.performanceTrace = trace
}

export const terminalSessionService = createTerminalSessionService(terminalRuntime)
export const agentTerminalSessions = terminalSessionService.createClient('agent-terminal-surfaces')
export const regularTerminalSessions = terminalSessionService.createClient('terminal-plugin-surfaces')
export const scopedAgentTerminalSessions = terminalSessionService.createClient('scoped-agent-plugin-surfaces')
export const terminalDiagnostics = terminalRuntime.diagnostics

export function getTerminalRuntimeForTests() {
  return terminalRuntime
}
