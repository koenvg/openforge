import { describe, expect, it, vi } from 'vitest'
import { XTERM_AUTHORITATIVE_TERMINAL_CONTRACT } from './terminalAuthority'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import type { PoolEntry } from './terminalRuntimeTypes'

function createEntry(terminalKey: string): PoolEntry {
  return {
    shellSessionKey: terminalKey,
    ptyActive: false,
    needsClear: true,
    spawnPending: false,
    currentPtyInstance: null,
    hasOutput: false,
  } as PoolEntry
}

describe('terminal session lifecycle', () => {
  it('applies a restored PTY instance when its terminal entry becomes available', () => {
    const entries = new Map<string, PoolEntry>()
    const lifecycle = createTerminalSessionLifecycle(key => entries.get(key), XTERM_AUTHORITATIVE_TERMINAL_CONTRACT)
    const listener = vi.fn()
    lifecycle.subscribeShellLifecycle('T-1-shell-0', listener)

    lifecycle.restorePtyInstance('T-1-shell-0', 42)

    const entry = createEntry('T-1-shell-0')
    entries.set(entry.shellSessionKey, entry)
    lifecycle.applyRestoredPtyInstance(entry)

    expect(entry).toMatchObject({
      ptyActive: true,
      needsClear: false,
      currentPtyInstance: 42,
      authority: {
        shellSessionKey: 'T-1-shell-0',
        ptyInstanceId: 42,
        contract: {
          parsedStateOwner: 'xterm',
          queryResponseOwner: 'xterm',
          replayOwner: 'pty-byte-buffer',
        },
      },
    })
    expect(listener).toHaveBeenCalledWith({
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 42,
      hasOutput: false,
    })
  })

  it('publishes output and exit transitions for a terminal session', () => {
    const entry = createEntry('T-1-shell-0')
    const lifecycle = createTerminalSessionLifecycle(() => entry, XTERM_AUTHORITATIVE_TERMINAL_CONTRACT)
    const listener = vi.fn()
    lifecycle.subscribeShellLifecycle(entry.shellSessionKey, listener)

    lifecycle.markPtyOutput(entry)
    lifecycle.markPtyExited(entry)

    expect(listener).toHaveBeenNthCalledWith(1, {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: true,
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: null,
      hasOutput: true,
    })
  })

  it('rebinds terminal authority when restored shell state selects another PTY instance', () => {
    const entry = createEntry('T-1-shell-0')
    const lifecycle = createTerminalSessionLifecycle(() => entry, XTERM_AUTHORITATIVE_TERMINAL_CONTRACT)

    lifecycle.updateShellLifecycleState(entry.shellSessionKey, {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 7,
      hasOutput: true,
    })

    expect(entry.authority).toMatchObject({
      shellSessionKey: 'T-1-shell-0',
      ptyInstanceId: 7,
      contract: { queryResponseOwner: 'xterm' },
    })
  })

  it('retains an unmatched restored PTY instance when active sessions are cleared', () => {
    const entries = new Map<string, PoolEntry>()
    const lifecycle = createTerminalSessionLifecycle(key => entries.get(key), XTERM_AUTHORITATIVE_TERMINAL_CONTRACT)
    lifecycle.restorePtyInstance('T-1-shell-0', 42)

    lifecycle.clearAll()

    const entry = createEntry('T-1-shell-0')
    entries.set(entry.shellSessionKey, entry)
    lifecycle.applyRestoredPtyInstance(entry)
    expect(entry.currentPtyInstance).toBe(42)
  })
})
