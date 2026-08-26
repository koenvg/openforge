import type { TerminalQueryResponseWrite } from './terminalAuthority'

export interface TerminalGeometry {
  cols: number
  rows: number
}

export interface TerminalReplay {
  data: string | null
  isLive: boolean
  ptyInstanceId: number | null
}

export interface TerminalOutputEvent {
  data: string
  ptyInstanceId: number
}

export interface TerminalExitEvent {
  ptyInstanceId: number
}
export interface TerminalTransportDisposable {
  dispose(): void
}

export interface TerminalSessionTransportHandlers {
  onOutput(event: TerminalOutputEvent): void
  onExit(event: TerminalExitEvent): void
}

export interface TerminalTransport {
  subscribeSession(
    shellSessionKey: string,
    handlers: TerminalSessionTransportHandlers,
  ): Promise<TerminalTransportDisposable>
  subscribeConnectionRestored(
    handler: () => void,
  ): Promise<TerminalTransportDisposable>
  readReplay(shellSessionKey: string): Promise<TerminalReplay>
  writeUserInput(shellSessionKey: string, data: string): Promise<void>
  writeQueryResponse(response: TerminalQueryResponseWrite): Promise<void>
  resize(shellSessionKey: string, geometry: TerminalGeometry): Promise<void>
  dispose(): void
}
