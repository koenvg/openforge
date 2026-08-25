import {
  bindTerminalAuthority,
  type TerminalAuthorityContract,
} from './terminalAuthority'
import type {
  PoolEntry,
  PtyBufferState,
  PtyOutputEventPayload,
  TerminalRuntimeHost,
} from './terminalRuntimeTypes'

interface TerminalStateViewOptions {
  host: TerminalRuntimeHost
  authority: TerminalAuthorityContract
  resetEntry(entry: PoolEntry): void
  markOutput(entry: PoolEntry): void
}

const MAX_PENDING_OUTPUTS = 256

function pushPendingOutput(queue: PtyOutputEventPayload[], value: PtyOutputEventPayload): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalStateView({
  host,
  authority,
  resetEntry,
  markOutput,
}: TerminalStateViewOptions) {
  function writeOutput(entry: PoolEntry, payload: PtyOutputEventPayload): void {
    if (entry.authority?.ptyInstanceId !== payload.instance_id) return
    if (!payload.data) return
    if (entry.needsClear) {
      resetEntry(entry)
      entry.needsClear = false
    }
    entry.view.writeLive({
      data: payload.data,
      ptyInstanceId: payload.instance_id,
    })
    markOutput(entry)
  }

  function flushPendingOutput(entry: PoolEntry): void {
    const pending = entry.pendingPtyOutput.splice(0)
    for (const payload of pending) writeOutput(entry, payload)
  }

  function activateReplay(entry: PoolEntry, state: PtyBufferState, reset: boolean): void {
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = state.isLive
    entry.needsClear = false
    entry.terminalStateSource = 'pty-byte-replay'
    if (state.instanceId !== null) {
      entry.currentPtyInstance = state.instanceId
      entry.authority = bindTerminalAuthority(authority, entry.shellSessionKey, state.instanceId)
    }
    if (state.buffer) {
      entry.view.bootstrap(state.buffer, state.instanceId)
      entry.hasOutput = true
    }
    flushPendingOutput(entry)
  }

  async function recover(entry: PoolEntry, reset = true): Promise<void> {
    if (entry.terminalReplayRecovery) return entry.terminalReplayRecovery
    const requestedInstance = entry.currentPtyInstance
    const previousStateSource = entry.terminalStateSource
    entry.terminalStateSource = 'bootstrapping'
    const recovery = host.getPtyBuffer(entry.shellSessionKey).then((state) => {
      const instanceChanged = entry.currentPtyInstance !== requestedInstance
        || (requestedInstance !== null && state.instanceId !== requestedInstance)
      if (instanceChanged) {
        entry.terminalStateSource = previousStateSource
        flushPendingOutput(entry)
        return
      }
      activateReplay(entry, state, reset)
    })
    entry.terminalReplayRecovery = recovery
    try {
      await recovery
    } finally {
      if (entry.terminalReplayRecovery === recovery) entry.terminalReplayRecovery = null
    }
  }

  function handlePtyOutput(entry: PoolEntry, payload: PtyOutputEventPayload): void {
    if (entry.spawnPending || entry.terminalStateSource === 'bootstrapping') {
      pushPendingOutput(entry.pendingPtyOutput, payload)
      return
    }
    writeOutput(entry, payload)
  }

  return { handlePtyOutput, recover, flushPendingOutput }
}
