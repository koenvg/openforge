import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ILinkHandler, Terminal } from '@xterm/xterm'
import { terminalLogMessage } from './terminalLogging'

export interface TerminalLinkOptions {
  openLink(url: string): Promise<void>
  loggerName?: string
}

function openTerminalLink(options: TerminalLinkOptions, event: MouseEvent, uri: string): void {
  event.preventDefault()
  event.stopPropagation()
  options.openLink(uri).catch(error => {
    console.error(terminalLogMessage(options.loggerName, 'Failed to open terminal link:'), error)
  })
}

export function createTerminalLinkHandler(options: TerminalLinkOptions): ILinkHandler {
  return {
    allowNonHttpProtocols: false,
    activate: (event, uri) => openTerminalLink(options, event, uri),
  }
}

export function loadTerminalWebLinksAddon(
  options: TerminalLinkOptions,
  terminal: Terminal,
): void {
  terminal.loadAddon(new WebLinksAddon((event, uri) => {
    openTerminalLink(options, event, uri)
  }))
}
