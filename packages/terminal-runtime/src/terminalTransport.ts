
import type { LiveModelOutputSubscriptionSnapshot } from './liveModelOutputSubscription'
export interface TerminalGeometry {
  cols: number
  rows: number
}

export interface TerminalSnapshot {
  data: Uint8Array
  ptyInstanceId: number
  watermark: number
  compatibilityData?: Uint8Array
  continuationData: Uint8Array
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
  startSequence: number
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

export interface TerminalSessionTransportSubscription extends TerminalTransportDisposable {
  setModelOutputEnabled(enabled: boolean): Promise<void>
  snapshot?(): LiveModelOutputSubscriptionSnapshot
}

export interface TerminalSessionTransportHandlers {
  onModelOutput(event: TerminalModelOutputEvent): void
  onModelDisabled(event: TerminalModelDisabledEvent): void
  onExit(event: TerminalExitEvent): void
}

export interface TerminalResizeAttachment {
  sessionId: string
  sessionGeneration: number
  attachmentGeneration: number
}

export interface TerminalTransport {
  supportsGeometryLease?: boolean
  subscribeSession(
    shellSessionKey: string,
    handlers: TerminalSessionTransportHandlers,
  ): Promise<TerminalSessionTransportSubscription>
  subscribeConnectionRestored(
    handler: () => void,
  ): Promise<TerminalTransportDisposable>
  readReplay(shellSessionKey: string): Promise<TerminalReplay>
  writeUserInput(shellSessionKey: string, data: string | Uint8Array): Promise<void>
  resize(shellSessionKey: string, geometry: TerminalGeometry, attachment?: TerminalResizeAttachment): Promise<void>
  dispose(): void
}
