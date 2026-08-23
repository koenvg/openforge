import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ILinkHandler, Terminal } from '@xterm/xterm'
import { terminalLogMessage } from './terminalLogging'
import type { TerminalRuntimeHost } from './terminalRuntimeTypes'

function openTerminalLink(host: TerminalRuntimeHost, terminalKey: string, event: MouseEvent, uri: string): void {
  event.preventDefault()
  event.stopPropagation()
  host.openLink(terminalKey, uri).catch(error => {
    console.error(terminalLogMessage(host.loggerName, 'Failed to open terminal link:'), error)
  })
}

export function createTerminalLinkHandler(host: TerminalRuntimeHost, terminalKey: string): ILinkHandler {
  return {
    allowNonHttpProtocols: false,
    activate: (event, uri) => openTerminalLink(host, terminalKey, event, uri),
  }
}

export function loadTerminalWebLinksAddon(
  host: TerminalRuntimeHost,
  terminalKey: string,
  terminal: Terminal,
): void {
  terminal.loadAddon(new WebLinksAddon((event, uri) => {
    openTerminalLink(host, terminalKey, event, uri)
  }))
}
