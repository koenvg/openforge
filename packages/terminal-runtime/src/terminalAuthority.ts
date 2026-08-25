export interface XtermAuthoritativeTerminalContract {
  readonly mode: 'xterm-authoritative'
  readonly parsedStateOwner: 'xterm'
  readonly queryResponseOwner: 'xterm'
  readonly replayOwner: 'pty-byte-buffer'
  readonly snapshotOwner: null
  readonly diagnosticModel: {
    readonly mayObservePtyBytes: true
    readonly maySendQueryResponses: false
    readonly mayProvideReplay: false
  }
}

export const XTERM_AUTHORITATIVE_TERMINAL_CONTRACT: XtermAuthoritativeTerminalContract = Object.freeze({
  mode: 'xterm-authoritative',
  parsedStateOwner: 'xterm',
  queryResponseOwner: 'xterm',
  replayOwner: 'pty-byte-buffer',
  snapshotOwner: null,
  diagnosticModel: Object.freeze({
    mayObservePtyBytes: true,
    maySendQueryResponses: false,
    mayProvideReplay: false,
  }),
})

export type TerminalAuthorityContract = XtermAuthoritativeTerminalContract

export interface TerminalAuthorityBinding {
  readonly shellSessionKey: string
  readonly ptyInstanceId: number
  readonly contract: TerminalAuthorityContract
}

export function bindTerminalAuthority(
  contract: TerminalAuthorityContract,
  shellSessionKey: string,
  ptyInstanceId: number,
): TerminalAuthorityBinding {
  return { shellSessionKey, ptyInstanceId, contract }
}

export interface TerminalQueryResponseWrite {
  readonly shellSessionKey: string
  readonly ptyInstanceId: number
  readonly data: string
}

export function isTerminalQueryResponse(data: string): boolean {
  return /^\u001b\[(?:[?>]?[\d;]*c|\??\d+(?:;\d+)?[nR]|\??\d+;\d+\$y|[468];\d+;\d+t)$/.test(data)
    || /^\u001bP[01]\$r[\s\S]*\u001b\\$/.test(data)
    || /^\u001b\](?:4;\d+|1[012]);rgb:[^\u001b]*(?:\u0007|\u001b\\)$/.test(data)
}
