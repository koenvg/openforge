import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/pty-session-key-v1.json'
import {
  createIndexedShellSessionKey,
  createScopedAgentSessionKey,
  encodeSessionScope,
  parsePtySessionKey,
} from './index'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('PTY session key', () => {
  it.each(fixture.validScopes)('builds and parses scoped agent key fixture $id', async (vector) => {
    expect(toHex(encodeSessionScope(vector.scope))).toBe(vector.canonicalHex)
    await expect(createScopedAgentSessionKey(vector.scope)).resolves.toBe(vector.key)
    expect(parsePtySessionKey(vector.key)).toEqual({
      kind: 'scoped-agent',
      digest: vector.digest,
    })
  })

  it('accepts exact UTF-8 byte limits without normalizing scope identity', async () => {
    const atLimits = {
      namespace: 'é'.repeat(64),
      targetKey: 't'.repeat(2_048),
      revision: '🚀'.repeat(64),
    }
    await expect(createScopedAgentSessionKey(atLimits)).resolves.toMatch(
      /^scoped-agent-v1-[0-9a-f]{64}$/,
    )

    const composed = await createScopedAgentSessionKey({
      namespace: 'é',
      targetKey: 'target',
      revision: 'revision',
    })
    const decomposed = await createScopedAgentSessionKey({
      namespace: 'é',
      targetKey: 'target',
      revision: 'revision',
    })
    expect(composed).not.toBe(decomposed)
  })

  it.each(fixture.existingKeys)('preserves existing key fixture $key', ({ key, parsed }) => {
    expect(parsePtySessionKey(key)).toEqual(parsed)
  })

  it.each(fixture.invalidScopes)('rejects invalid Session Scope fixture $id before hashing', async (vector) => {
    const scope = { namespace: 'plugin', targetKey: 'target', revision: 'revision' }
    scope[vector.field as keyof typeof scope] = vector.value.repeat(vector.repeat)

    await expect(createScopedAgentSessionKey(scope)).rejects.toThrow(vector.error)
  })

  it.each(['\uD800', '\uDC00'])('rejects malformed UTF-16 scope values before hashing', async (value) => {
    await expect(createScopedAgentSessionKey({
      namespace: value,
      targetKey: 'target',
      revision: 'revision',
    })).rejects.toThrow('Session Scope namespace must contain well-formed Unicode')
  })

  it('distinguishes agent sessions from indexed shell sessions', () => {
    expect(parsePtySessionKey('T-1')).toEqual({
      kind: 'agent',
      taskId: 'T-1',
    })
    expect(parsePtySessionKey('T-1-shell-2')).toEqual({
      kind: 'indexed-shell',
      taskId: 'T-1',
      terminalIndex: 2,
    })
    expect(parsePtySessionKey('T-1-shell-4294967295')).toEqual({
      kind: 'indexed-shell',
      taskId: 'T-1',
      terminalIndex: 4_294_967_295,
    })
  })

  it('constructs indexed shell session keys from typed parts', () => {
    expect(createIndexedShellSessionKey({ taskId: 'T-1', terminalIndex: 2 })).toBe('T-1-shell-2')
    expect(createIndexedShellSessionKey({
      taskId: 'T-1',
      terminalIndex: 4_294_967_295,
    })).toBe('T-1-shell-4294967295')
  })

  it('preserves keys whose shell suffix is not a valid index', () => {
    expect(parsePtySessionKey('task-shell-feature')).toEqual({
      kind: 'agent',
      taskId: 'task-shell-feature',
    })
    expect(parsePtySessionKey('task-shell-4294967296')).toEqual({
      kind: 'agent',
      taskId: 'task-shell-4294967296',
    })
  })

  it('rejects invalid indexed shell session key parts', () => {
    expect(() => createIndexedShellSessionKey({ taskId: '', terminalIndex: 0 })).toThrow(
      'Shell Session Key requires a taskId',
    )
    expect(() => createIndexedShellSessionKey({ taskId: 'T-1', terminalIndex: -1 })).toThrow(
      'Shell Session Key requires a non-negative safe integer terminalIndex',
    )
    expect(() => createIndexedShellSessionKey({ taskId: 'T-1', terminalIndex: 1.5 })).toThrow(
      'Shell Session Key requires a non-negative safe integer terminalIndex',
    )
    expect(() => createIndexedShellSessionKey({
      taskId: 'T-1',
      terminalIndex: 4_294_967_296,
    })).toThrow('Shell Session Key requires a terminalIndex between 0 and 4294967295')
  })
})
