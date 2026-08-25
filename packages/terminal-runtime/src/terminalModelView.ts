import { terminalLogMessage } from './terminalLogging'
import type {
  PoolEntry,
  PtyBufferState,
  PtyOutputEventPayload,
  TerminalModelDisabledEventPayload,
  TerminalModelOutputEventPayload,
  TerminalRuntimeHost,
  TerminalViewSnapshot,
} from './terminalRuntimeTypes'

interface TerminalModelViewOptions {
  host: TerminalRuntimeHost
  resetEntry(entry: PoolEntry): void
  markOutput(entry: PoolEntry): void
}

const MAX_PENDING_FRAMES = 256

function pushBounded<T>(queue: T[], value: T): void {
  if (queue.length === MAX_PENDING_FRAMES) queue.shift()
  queue.push(value)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createTerminalModelView({
  host,
  resetEntry,
  markOutput,
}: TerminalModelViewOptions) {
  function writeLegacyOutput(entry: PoolEntry, payload: PtyOutputEventPayload): void {
    if (payload.instance_id != null
      && entry.currentPtyInstance != null
      && payload.instance_id !== entry.currentPtyInstance) return
    if (!payload.data) return
    if (entry.needsClear) {
      resetEntry(entry)
      entry.needsClear = false
    }
    entry.terminal.write(payload.data)
    markOutput(entry)
  }

  function writeModelOutput(entry: PoolEntry, payload: TerminalModelOutputEventPayload): boolean {
    if (payload.instance_id !== entry.currentPtyInstance) return true
    const currentSequence = entry.terminalModelSequence
    if (currentSequence == null || payload.sequence <= currentSequence) return true
    if (payload.sequence !== currentSequence + 1) return false
    entry.terminal.write(decodeBase64(payload.data))
    entry.terminalModelSequence = payload.sequence
    markOutput(entry)
    return true
  }

  function activateLegacy(entry: PoolEntry, state: PtyBufferState, reset: boolean): void {
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = state.isLive
    entry.needsClear = false
    entry.terminalStateSource = 'legacy'
    entry.terminalModelSequence = null
    entry.terminalModelRejectedInstance = entry.pendingTerminalModelOutput.at(-1)?.instance_id ?? null
    if (state.buffer) {
      entry.terminal.write(state.buffer)
      entry.hasOutput = true
    }
    const pending = entry.pendingPtyOutput.splice(0)
    entry.pendingTerminalModelOutput.length = 0
    for (const payload of pending) writeLegacyOutput(entry, payload)
  }

  function activateGhostty(
    entry: PoolEntry,
    snapshot: TerminalViewSnapshot,
    reset: boolean,
  ): boolean {
    if (reset) {
      resetEntry(entry)
      entry.hasOutput = false
    }
    entry.ptyActive = true
    entry.needsClear = false
    entry.currentPtyInstance = snapshot.instanceId
    entry.terminalModelSequence = snapshot.watermark
    entry.terminalModelRejectedInstance = null
    entry.terminalStateSource = 'ghostty'
    const data = decodeBase64(snapshot.data)
    if (data.length > 0) {
      entry.terminal.write(data)
      entry.hasOutput = true
    }
    entry.pendingPtyOutput.length = 0
    const pending = entry.pendingTerminalModelOutput.splice(0)
    for (const payload of pending) {
      if (!writeModelOutput(entry, payload)) return false
    }
    return true
  }

  async function recover(entry: PoolEntry, reset = true): Promise<void> {
    if (entry.terminalModelRecovery) return entry.terminalModelRecovery
    entry.terminalStateSource = 'bootstrapping'
    const recovery = (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const snapshot = await host.getTerminalViewSnapshot?.(entry.taskId) ?? null
          if (!snapshot) break
          if (activateGhostty(entry, snapshot, reset || attempt > 0)) return
          entry.terminalStateSource = 'bootstrapping'
        }
      } catch (error) {
        console.warn(
          terminalLogMessage(host.loggerName, 'Ghostty terminal snapshot unavailable; using legacy replay:'),
          error,
        )
      }
      const state = await host.getPtyBuffer(entry.taskId)
      activateLegacy(entry, state, reset)
    })()
    entry.terminalModelRecovery = recovery
    try {
      await recovery
    } finally {
      if (entry.terminalModelRecovery === recovery) entry.terminalModelRecovery = null
    }
  }

  function handlePtyOutput(entry: PoolEntry, payload: PtyOutputEventPayload): void {
    if (entry.terminalStateSource === 'bootstrapping') {
      pushBounded(entry.pendingPtyOutput, payload)
      return
    }
    if (entry.terminalStateSource === 'legacy') writeLegacyOutput(entry, payload)
  }

  function handleModelOutput(entry: PoolEntry, payload: TerminalModelOutputEventPayload): void {
    if (entry.terminalStateSource === 'bootstrapping') {
      pushBounded(entry.pendingTerminalModelOutput, payload)
      return
    }
    if (entry.terminalStateSource === 'legacy') {
      if (entry.terminalModelRejectedInstance === payload.instance_id) return
      pushBounded(entry.pendingTerminalModelOutput, payload)
      void recover(entry)
      return
    }
    if (entry.terminalStateSource !== 'ghostty') return
    if (writeModelOutput(entry, payload)) return
    pushBounded(entry.pendingTerminalModelOutput, payload)
    void recover(entry)
  }

  function handleModelDisabled(entry: PoolEntry, payload: TerminalModelDisabledEventPayload): void {
    if (entry.currentPtyInstance != null && payload.instance_id !== entry.currentPtyInstance) return
    void recover(entry)
  }

  return { handleModelDisabled, handleModelOutput, handlePtyOutput, recover }
}
