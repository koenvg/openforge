
export interface TerminalGeometry {
  cols: number
  rows: number
}

export interface TerminalSnapshot {
  data: Uint8Array
  ptyInstanceId: number
  watermark: number
  compatibilityData?: Uint8Array
}

export interface TerminalReplay {
  historicalData: string | null
  isLive: boolean
  ptyInstanceId: number | null
  snapshot?: TerminalSnapshot
}


export interface TerminalModelOutputEvent {
  data: Uint8Array
  ptyInstanceId: number
  sequence: number
}

export interface TerminalModelDisabledEvent {
  ptyInstanceId: number
}

export interface TerminalExitEvent {
  ptyInstanceId: number
}
export interface TerminalTransportDisposable {
  dispose(): void
}

export interface TerminalSessionTransportHandlers {
  onModelOutput(event: TerminalModelOutputEvent): void
  onModelDisabled(event: TerminalModelDisabledEvent): void
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
  resize(shellSessionKey: string, geometry: TerminalGeometry): Promise<void>
  dispose(): void
}
