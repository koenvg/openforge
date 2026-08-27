import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  createTerminalRuntime,
  createTerminalSessionService,
} from '@openforge-app/terminal-runtime'
import { listenDesktopEvent } from './desktopIpc'
import type { TerminalDesktopEventName } from './desktopIpcContract'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import {
  getPtyBuffer,
  openUrl,
  resizePty,
  writePty,
  writeTerminalQueryResponse,
} from './ipc'
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
    sampleSessionConfiguration: () => ({ renderer: 'xterm' }),
    openLink: url => openUrl(url),
    themeMode,
    loggerName: 'terminalSessionService',
  },
  authority: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
})

export const terminalSessionService = createTerminalSessionService(terminalRuntime)
export const agentTerminalSessions = terminalSessionService.createClient('agent-terminal-surfaces')
export const regularTerminalSessions = terminalSessionService.createClient('terminal-plugin-surfaces')

export function getTerminalRuntimeForTests() {
  return terminalRuntime
}
