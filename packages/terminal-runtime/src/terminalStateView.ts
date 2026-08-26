import {
  bindTerminalAuthority,
  type TerminalAuthorityContract,
} from './terminalAuthority'
import type { TerminalOutputEvent, TerminalReplay, TerminalTransport } from './terminalTransport'
import type { PoolEntry } from './terminalRuntimeTypes'

interface TerminalStateViewOptions {
  transport: TerminalTransport
  authority: TerminalAuthorityContract
  resetEntry(entry: PoolEntry): void
  markOutput(entry: PoolEntry): void
}

const MAX_PENDING_OUTPUTS = 256

function pushPendingOutput(queue: TerminalOutputEvent[], value: TerminalOutputEvent): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalStateView({
  transport,
  authority,
  resetEntry,
  markOutput,
}: TerminalStateViewOptions) {
  function writeOutput(entry: PoolEntry, event: TerminalOutputEvent): void {
    if (entry.authority?.ptyInstanceId !== event.ptyInstanceId) return
    if (!event.data) return
    if (entry.needsClear) {
      resetEntry(entry)
      entry.needsClear = false
    }
    entry.view.writeLive({
      data: event.data,
      ptyInstanceId: event.ptyInstanceId,
    })
    markOutput(entry)
  }

  function flushPendingOutput(entry: PoolEntry): void {
    const pending = entry.pendingPtyOutput.splice(0)
    for (const event of pending) writeOutput(entry, event)
  }

  function activateReplay(entry: PoolEntry, replay: TerminalReplay, reset: boolean): void {
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = replay.isLive
    entry.needsClear = false
    entry.terminalStateSource = 'pty-byte-replay'
    if (replay.ptyInstanceId !== null) {
      entry.currentPtyInstance = replay.ptyInstanceId
      entry.authority = bindTerminalAuthority(authority, entry.shellSessionKey, replay.ptyInstanceId)
    }
    if (replay.data) {
      entry.view.bootstrap(replay.data, replay.ptyInstanceId)
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
      activateReplay(entry, replay, reset)
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
      pushPendingOutput(entry.pendingPtyOutput, event)
      return
    }
    writeOutput(entry, event)
  }

  return { handlePtyOutput, recover, flushPendingOutput }
}
