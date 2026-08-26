import { describe, expect, it } from 'vitest'
import { createIndexedShellSessionKey, parsePtySessionKey } from './index'

describe('PTY session key', () => {
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
