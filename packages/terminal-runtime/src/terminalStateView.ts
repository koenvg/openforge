import type {
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalTransport,
} from './terminalTransport'
import type { PoolEntry } from './terminalRuntimeTypes'
import { recordTerminalOutput, synchronizeTerminalOutputObservation } from './terminalOutputObservation'

interface TerminalStateViewOptions {
  transport: TerminalTransport
  markOutput(entry: PoolEntry): void
}

interface TerminalRenderRevision {
  attachmentGeneration: number
  visibilityGeneration: number
}

const MAX_PENDING_OUTPUTS = 256

function pushBounded<T>(queue: T[], value: T): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalStateView({
  transport,
  markOutput,
}: TerminalStateViewOptions) {

  function writeTerminalModelOutput(
    entry: PoolEntry,
    event: TerminalModelOutputEvent,
  ): boolean {
    if (entry.currentPtyInstance !== event.ptyInstanceId) return true
    const currentSequence = entry.terminalModelSequence
    if (currentSequence === null || event.sequence <= currentSequence) return true
    if (event.startSequence !== currentSequence + 1) return false
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
    if (!entry.attached || !entry.viewVisible) {
      entry.pendingTerminalModelOutput.length = 0
      entry.viewNeedsRecovery = true
      return
    }
    const pending = entry.pendingTerminalModelOutput.splice(0)
    for (const event of pending) {
      if (!writeTerminalModelOutput(entry, event)) {
        pushBounded(entry.pendingTerminalModelOutput, event)
        void recover(entry)
        break
      }
    }
  }


  function isCurrentRenderRevision(
    entry: PoolEntry,
    revision: TerminalRenderRevision | null,
  ): boolean {
    return revision !== null
      && entry.attached
      && entry.viewVisible
      && entry.attachmentGeneration === revision.attachmentGeneration
      && entry.viewVisibilityGeneration === revision.visibilityGeneration
  }

  async function activateGhosttySnapshot(
    entry: PoolEntry,
    replay: TerminalReplay,
    renderRevision: TerminalRenderRevision | null,
  ): Promise<void> {
    if (replay.ptyInstanceId === null) {
      entry.ptyActive = false
      entry.shellExited = false
      entry.needsClear = false
      entry.outputSequence = 0
      entry.currentPtyInstance = null
      synchronizeTerminalOutputObservation(entry.terminalOutputObservation, null)
      entry.terminalModelSequence = null
      entry.pendingTerminalModelOutput.length = 0
      entry.hasOutput = Boolean(replay.historicalData)
      if (!isCurrentRenderRevision(entry, renderRevision)) {
        entry.terminalStateSource = 'ghostty-snapshot'
        entry.viewNeedsRecovery = true
        return
      }
      await entry.view.replaceSnapshot({
        data: replay.historicalData ?? '',
        ptyInstanceId: null,
        sequence: entry.outputSequence,
      })
      entry.terminalStateSource = 'ghostty-snapshot'
      entry.viewNeedsRecovery = !isCurrentRenderRevision(entry, renderRevision)
      return
    }
    const snapshot = replay.snapshot
    if (!snapshot || snapshot.ptyInstanceId !== replay.ptyInstanceId) {
      throw new Error('Ghostty-authoritative terminal state requires a current snapshot')
    }
    entry.ptyActive = replay.isLive
    entry.shellExited = !replay.isLive
    entry.needsClear = false
    entry.outputSequence = 0
    entry.currentPtyInstance = replay.ptyInstanceId
    entry.terminalModelSequence = snapshot.watermark
    synchronizeTerminalOutputObservation(
      entry.terminalOutputObservation,
      replay.ptyInstanceId,
      snapshot.watermark,
    )
    entry.hasOutput = snapshot.data.length > 0 || Boolean(snapshot.compatibilityData?.length)
    if (!isCurrentRenderRevision(entry, renderRevision)) {
      entry.terminalStateSource = 'ghostty-snapshot'
      entry.viewNeedsRecovery = true
      return
    }
    await entry.view.replaceSnapshot({
      data: snapshot.data,
      compatibilityData: snapshot.compatibilityData,
      ptyInstanceId: replay.ptyInstanceId,
      sequence: entry.outputSequence,
    })
    entry.terminalStateSource = 'ghostty-snapshot'
    const currentRenderRevision = isCurrentRenderRevision(entry, renderRevision)
    entry.viewNeedsRecovery = !currentRenderRevision
    if (currentRenderRevision) flushPendingOutput(entry)
  }

  async function recover(entry: PoolEntry): Promise<void> {
    if (entry.terminalReplayRecovery) return entry.terminalReplayRecovery
    const renderRequested = entry.attached && entry.viewVisible
    const requestedAttachmentGeneration = entry.attachmentGeneration
    const requestedVisibilityGeneration = entry.viewVisibilityGeneration
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
      const sameViewState = entry.attachmentGeneration === requestedAttachmentGeneration
        && entry.viewVisibilityGeneration === requestedVisibilityGeneration
      const renderRevision = renderRequested && sameViewState
        ? {
            attachmentGeneration: requestedAttachmentGeneration,
            visibilityGeneration: requestedVisibilityGeneration,
          }
        : null
      return activateGhosttySnapshot(entry, replay, renderRevision)
    })
    entry.terminalReplayRecovery = recovery
    try {
      await recovery
    } finally {
      if (entry.terminalReplayRecovery === recovery) entry.terminalReplayRecovery = null
    }
  }


  function handleTerminalModelOutput(entry: PoolEntry, event: TerminalModelOutputEvent): void {
    recordTerminalOutput(entry.terminalOutputObservation, event)
    if (!entry.attached || !entry.viewVisible) {
      if (entry.currentPtyInstance === event.ptyInstanceId) {
        entry.terminalModelSequence = Math.max(entry.terminalModelSequence ?? 0, event.sequence)
        entry.viewNeedsRecovery = true
        markOutput(entry)
      }
      return
    }
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
