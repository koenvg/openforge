export type IndexedShellSessionKeyParts = {
  taskId: string
  terminalIndex: number
}

export type PtySessionKey =
  | { kind: 'agent'; taskId: string }
  | { kind: 'indexed-shell'; taskId: string; terminalIndex: number }

const MAX_TERMINAL_INDEX = 0xffff_ffff
const INDEXED_SHELL_SUFFIX = /^(.*)-shell-(\d+)$/

export function parsePtySessionKey(sessionKey: string): PtySessionKey {
  const match = INDEXED_SHELL_SUFFIX.exec(sessionKey)
  const terminalIndex = Number(match?.[2])
  if (
    !match?.[1]
    || !Number.isSafeInteger(terminalIndex)
    || terminalIndex > MAX_TERMINAL_INDEX
  ) {
    return { kind: 'agent', taskId: sessionKey }
  }

  return {
    kind: 'indexed-shell',
    taskId: match[1],
    terminalIndex,
  }
}

export function createIndexedShellSessionKey({
  taskId,
  terminalIndex,
}: IndexedShellSessionKeyParts): string {
  if (!taskId) {
    throw new Error('Shell Session Key requires a taskId')
  }
  if (!Number.isSafeInteger(terminalIndex) || terminalIndex < 0) {
    throw new Error('Shell Session Key requires a non-negative safe integer terminalIndex')
  }
  if (terminalIndex > MAX_TERMINAL_INDEX) {
    throw new Error('Shell Session Key requires a terminalIndex between 0 and 4294967295')
  }

  return `${taskId}-shell-${terminalIndex}`
}
