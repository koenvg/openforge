import type {
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalTransport,
} from './terminalTransport'
import type { PoolEntry } from './terminalRuntimeTypes'

interface TerminalStateViewOptions {
  transport: TerminalTransport
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
  resetEntry,
  markOutput,
}: TerminalStateViewOptions) {

  function writeTerminalModelOutput(
    entry: PoolEntry,
    event: TerminalModelOutputEvent,
  ): boolean {
    if (entry.currentPtyInstance !== event.ptyInstanceId) return true
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
    const pending = entry.pendingTerminalModelOutput.splice(0)
    for (const event of pending) {
      if (!writeTerminalModelOutput(entry, event)) {
        pushBounded(entry.pendingTerminalModelOutput, event)
        void recover(entry)
        break
      }
    }
  }


  function activateGhosttySnapshot(entry: PoolEntry, replay: TerminalReplay, reset: boolean): void {
    if (replay.ptyInstanceId === null) {
      if (reset) {
        resetEntry(entry)
        entry.hasOutput = false
      }
      entry.ptyActive = false
      entry.shellExited = false
      entry.needsClear = false
      entry.outputSequence = 0
      entry.currentPtyInstance = null
      entry.terminalStateSource = 'ghostty-snapshot'
      entry.terminalModelSequence = null
      entry.pendingTerminalModelOutput.length = 0
      entry.hasOutput = Boolean(replay.historicalData)
      if (replay.historicalData) {
        entry.view.bootstrap(replay.historicalData, null, entry.outputSequence)
      }
      return
    }
    const snapshot = replay.snapshot
    if (!snapshot || snapshot.ptyInstanceId !== replay.ptyInstanceId) {
      throw new Error('Ghostty-authoritative terminal state requires a current snapshot')
    }
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = replay.isLive
    entry.shellExited = !replay.isLive
    entry.needsClear = false
    entry.outputSequence = 0
    entry.currentPtyInstance = replay.ptyInstanceId
    entry.terminalStateSource = 'ghostty-snapshot'
    entry.terminalModelSequence = snapshot.watermark
    // Seed renderer-only state, such as inline images, before the Ghostty snapshot
    // establishes the canonical parsed terminal state.
    if (snapshot.compatibilityData?.length) {
      entry.view.bootstrap(snapshot.compatibilityData, replay.ptyInstanceId, entry.outputSequence)
      entry.hasOutput = true
    }
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
      activateGhosttySnapshot(entry, replay, reset)
    })
    entry.terminalReplayRecovery = recovery
    try {
      await recovery
    } finally {
      if (entry.terminalReplayRecovery === recovery) entry.terminalReplayRecovery = null
    }
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
    if (entry.currentPtyInstance !== event.ptyInstanceId) return
    entry.ptyActive = false
  }

  return {
    handleTerminalModelOutput,
    handleTerminalModelDisabled,
    recover,
    flushPendingOutput,
  }
}
