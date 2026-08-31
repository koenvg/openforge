import {
  createTerminalRuntime,
  createTerminalSessionService,
  type TerminalPerformanceTrace,
  type TerminalRuntimeEnvironment,
} from '@openforge-app/terminal-runtime'
import { listenDesktopEvent } from './desktopIpc'
import type { TerminalDesktopEventName } from './desktopIpcContract'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import {
  getPtyBuffer,
  openUrl,
  resizePty,
  writePty,
} from './ipc'
import { themeMode } from './theme'

const transport = createDesktopTerminalTransport({
  listenEvent: (eventName, handler) => listenDesktopEvent(
    eventName as TerminalDesktopEventName,
    handler,
  ),
  getPtyBuffer,
  writePty,
  resizePty,
})

const terminalRuntimeEnvironment: TerminalRuntimeEnvironment = {
  sampleSessionConfiguration: () => ({ renderer: 'xterm' }),
  openLink: url => openUrl(url),
  themeMode,
  loggerName: 'terminalSessionService',
}

const terminalRuntime = createTerminalRuntime({
  transport,
  environment: terminalRuntimeEnvironment,
})

export function configureTerminalPerformanceTrace(trace: TerminalPerformanceTrace | undefined): void {
  terminalRuntimeEnvironment.performanceTrace = trace
}

export const terminalSessionService = createTerminalSessionService(terminalRuntime)
export const agentTerminalSessions = terminalSessionService.createClient('agent-terminal-surfaces')
export const regularTerminalSessions = terminalSessionService.createClient('terminal-plugin-surfaces')

export function getTerminalRuntimeForTests() {
  return terminalRuntime
}
