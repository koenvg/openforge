import {
  bindTerminalAuthority,
  GHOSTTY_AUTHORITATIVE_TERMINAL_CONTRACT,
  type TerminalAuthorityContract,
} from './terminalAuthority'
import type {
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalOutputEvent,
  TerminalReplay,
  TerminalTransport,
} from './terminalTransport'
import type { PoolEntry } from './terminalRuntimeTypes'

interface TerminalStateViewOptions {
  transport: TerminalTransport
  authority: TerminalAuthorityContract
  resetEntry(entry: PoolEntry): void
  markOutput(entry: PoolEntry): void
}

const MAX_PENDING_OUTPUTS = 256

function pushBounded<T>(queue: T[], value: T): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalStateView({
  transport,
  authority,
  resetEntry,
  markOutput,
}: TerminalStateViewOptions) {
  function writePtyOutput(entry: PoolEntry, event: TerminalOutputEvent): void {
    if (entry.authority?.contract.mode !== 'xterm-authoritative') return
    if (entry.authority.ptyInstanceId !== event.ptyInstanceId || !event.data) return
    if (entry.needsClear) {
      resetEntry(entry)
      entry.needsClear = false
    }
    entry.outputSequence += 1
    entry.view.writeLive({
      data: event.data,
      ptyInstanceId: event.ptyInstanceId,
      sequence: entry.outputSequence,
    })
    markOutput(entry)
  }

  function writeTerminalModelOutput(
    entry: PoolEntry,
    event: TerminalModelOutputEvent,
  ): boolean {
    if (entry.authority?.contract.mode !== 'ghostty-authoritative') return true
    if (entry.authority.ptyInstanceId !== event.ptyInstanceId) return true
    const currentSequence = entry.terminalModelSequence
    if (currentSequence === null || event.sequence <= currentSequence) return true
    if (event.sequence !== currentSequence + 1) return false
    entry.outputSequence += 1
    entry.view.writeLive({
      data: event.data,
      ptyInstanceId: event.ptyInstanceId,
      sequence: entry.outputSequence,
    })
    entry.terminalModelSequence = event.sequence
    markOutput(entry)
    return true
  }

  function flushPendingOutput(entry: PoolEntry): void {
    if (entry.authority?.contract.mode === 'ghostty-authoritative') {
      entry.pendingPtyOutput.length = 0
      const pending = entry.pendingTerminalModelOutput.splice(0)
      for (const event of pending) {
        if (!writeTerminalModelOutput(entry, event)) {
          pushBounded(entry.pendingTerminalModelOutput, event)
          void recover(entry)
          break
        }
      }
      return
    }

    entry.pendingTerminalModelOutput.length = 0
    const pending = entry.pendingPtyOutput.splice(0)
    for (const event of pending) writePtyOutput(entry, event)
  }

  function activateXtermReplay(entry: PoolEntry, replay: TerminalReplay, reset: boolean): void {
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = replay.isLive
    entry.needsClear = false
    entry.outputSequence = 0
    entry.terminalStateSource = 'pty-byte-replay'
    entry.terminalModelSequence = null
    if (replay.ptyInstanceId !== null) {
      entry.currentPtyInstance = replay.ptyInstanceId
      entry.authority = bindTerminalAuthority(authority, entry.shellSessionKey, replay.ptyInstanceId)
    }
    if (replay.data) {
      entry.view.bootstrap(replay.data, replay.ptyInstanceId, entry.outputSequence)
      entry.hasOutput = true
    }
    flushPendingOutput(entry)
  }

  function activateGhosttySnapshot(entry: PoolEntry, replay: TerminalReplay, reset: boolean): void {
    const snapshot = replay.snapshot
    if (!snapshot || replay.ptyInstanceId === null || snapshot.ptyInstanceId !== replay.ptyInstanceId) {
      throw new Error('Ghostty-authoritative terminal state requires a current snapshot')
    }
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = replay.isLive
    entry.needsClear = false
    entry.outputSequence = 0
    entry.currentPtyInstance = replay.ptyInstanceId
    entry.authority = bindTerminalAuthority(
      GHOSTTY_AUTHORITATIVE_TERMINAL_CONTRACT,
      entry.shellSessionKey,
      replay.ptyInstanceId,
    )
    entry.terminalStateSource = 'ghostty-snapshot'
    entry.terminalModelSequence = snapshot.watermark
    if (snapshot.data.length > 0) {
      entry.view.bootstrap(snapshot.data, replay.ptyInstanceId, entry.outputSequence)
      entry.hasOutput = true
    }
    flushPendingOutput(entry)
  }

  async function recover(entry: PoolEntry, reset = true): Promise<void> {
    if (entry.terminalReplayRecovery) return entry.terminalReplayRecovery
    const requestedInstance = entry.currentPtyInstance
    const previousStateSource = entry.terminalStateSource
    entry.terminalStateSource = 'bootstrapping'
    const recovery = transport.readReplay(entry.shellSessionKey).then((replay) => {
      const instanceChanged = entry.currentPtyInstance !== requestedInstance
        || (requestedInstance !== null && replay.ptyInstanceId !== requestedInstance)
      if (instanceChanged) {
        entry.terminalStateSource = previousStateSource
        flushPendingOutput(entry)
        return
      }
      if (replay.authority === 'ghostty-authoritative') {
        activateGhosttySnapshot(entry, replay, reset)
      } else {
        activateXtermReplay(entry, replay, reset)
      }
    })
    entry.terminalReplayRecovery = recovery
    try {
      await recovery
    } finally {
      if (entry.terminalReplayRecovery === recovery) entry.terminalReplayRecovery = null
    }
  }

  function handlePtyOutput(entry: PoolEntry, event: TerminalOutputEvent): void {
    if (entry.spawnPending || entry.terminalStateSource === 'bootstrapping') {
      pushBounded(entry.pendingPtyOutput, event)
      return
    }
    writePtyOutput(entry, event)
  }

  function handleTerminalModelOutput(entry: PoolEntry, event: TerminalModelOutputEvent): void {
    if (entry.spawnPending || entry.terminalStateSource === 'bootstrapping') {
      pushBounded(entry.pendingTerminalModelOutput, event)
      return
    }
    if (writeTerminalModelOutput(entry, event)) return
    pushBounded(entry.pendingTerminalModelOutput, event)
    void recover(entry)
  }

  function handleTerminalModelDisabled(entry: PoolEntry, event: TerminalModelDisabledEvent): void {
    if (entry.authority?.contract.mode !== 'ghostty-authoritative') return
    if (entry.authority.ptyInstanceId !== event.ptyInstanceId) return
    entry.ptyActive = false
  }

  return {
    handlePtyOutput,
    handleTerminalModelOutput,
    handleTerminalModelDisabled,
    recover,
    flushPendingOutput,
  }
}
