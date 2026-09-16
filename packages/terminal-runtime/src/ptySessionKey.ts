export type IndexedShellSessionKeyParts = {
  taskId: string
  terminalIndex: number
}

export type SessionScope = {
  namespace: string
  targetKey: string
  revision: string
}

export type PtySessionKey =
  | { kind: 'agent'; taskId: string }
  | { kind: 'indexed-shell'; taskId: string; terminalIndex: number }
  | { kind: 'scoped-agent'; digest: string }

const MAX_TERMINAL_INDEX = 0xffff_ffff
const INDEXED_SHELL_SUFFIX = /^(.*)-shell-(\d+)$/
const SCOPED_AGENT_KEY = /^scoped-agent-v1-([0-9a-f]{64})$/
const SESSION_SCOPE_VERSION = 1
const LENGTH_PREFIX_BYTES = 4
const SESSION_SCOPE_FIELDS = [
  ['namespace', 128],
  ['targetKey', 2_048],
  ['revision', 256],
] as const

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function encodeScopeField(name: string, value: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (!value) {
    throw new Error(`Session Scope ${name} must not be empty`)
  }
  if (value.includes('\0')) {
    throw new Error(`Session Scope ${name} must not contain NUL`)
  }
  if (!isWellFormedUtf16(value)) {
    throw new Error(`Session Scope ${name} must contain well-formed Unicode`)
  }

  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength > maxBytes) {
    throw new Error(`Session Scope ${name} must not exceed ${maxBytes} UTF-8 bytes`)
  }
  return encoded
}

export function encodeSessionScope(scope: SessionScope): Uint8Array<ArrayBuffer> {
  const fields = SESSION_SCOPE_FIELDS.map(([name, maxBytes]) => (
    encodeScopeField(name, scope[name], maxBytes)
  ))
  const byteLength = 1 + fields.reduce(
    (length, field) => length + LENGTH_PREFIX_BYTES + field.byteLength,
    0,
  )
  const encoded = new Uint8Array(byteLength)
  const view = new DataView(encoded.buffer)
  encoded[0] = SESSION_SCOPE_VERSION
  let offset = 1

  for (const field of fields) {
    view.setUint32(offset, field.byteLength)
    offset += LENGTH_PREFIX_BYTES
    encoded.set(field, offset)
    offset += field.byteLength
  }

  return encoded
}

export async function createScopedAgentSessionKey(scope: SessionScope): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    encodeSessionScope(scope),
  ))
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  return `scoped-agent-v1-${hex}`
}

export function parsePtySessionKey(sessionKey: string): PtySessionKey {
  const scopedMatch = SCOPED_AGENT_KEY.exec(sessionKey)
  if (scopedMatch) {
    return { kind: 'scoped-agent', digest: scopedMatch[1] }
  }

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
