/** Experimental desktop-only native renderer protocol. No PTY ownership. */
export interface NativeTerminalBounds {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface NativeTerminalIdentity {
  viewId: string
  generation: number
}

export interface NativeTerminalState {
  id: number
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
}

export type NativeTerminalRequest =
  | (NativeTerminalIdentity & { operation: 'create'; terminalKey: string; bounds: NativeTerminalBounds; fontSize: number })
  | (NativeTerminalIdentity & { operation: 'write'; id: number; offset: number; data: Uint8Array })
  | (NativeTerminalIdentity & { operation: 'bounds'; id: number; bounds: NativeTerminalBounds })
  | (NativeTerminalIdentity & { operation: 'focus' | 'hide' | 'destroy'; id: number })

export type NativeTerminalReply<T extends NativeTerminalRequest> =
  T extends { operation: 'create' | 'bounds' } ? NativeTerminalState : void

export interface NativeTerminalInput extends NativeTerminalIdentity {
  id: number
  kind: 'input' | 'error'
  data: Uint8Array
}
