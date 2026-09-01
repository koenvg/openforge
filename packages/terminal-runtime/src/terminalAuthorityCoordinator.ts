import {
  createTerminalOutputObservation,
  recordTerminalOutput,
  synchronizeTerminalOutputObservation,
} from './terminalOutputObservation'
import type { TerminalPtyCoordinator } from './terminalPtyCoordinator'
import type { TerminalRuntimeEnvironment, TerminalStateSource } from './terminalRuntimeTypes'
import type {
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalSessionTransportSubscription,
  TerminalTransport,
} from './terminalTransport'
import type { TerminalView } from './terminalView'
import type {
  TerminalRenderRevision,
  TerminalViewAttachmentCoordinator,
} from './terminalViewAttachmentCoordinator'

const MAX_PENDING_OUTPUTS = 256

interface TerminalAuthorityCoordinatorOptions {
  shellSessionKey: string
  view: TerminalView
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  pty: TerminalPtyCoordinator
  attachment: TerminalViewAttachmentCoordinator
  isDisposed(): boolean
  notify(): void
}

export interface TerminalAuthorityCoordinator {
  start(): Promise<void>
  recoverFromAuthority(): Promise<void>
  resetForPtyInstance(instanceId: number | null): void
  setModelOutputEnabled(enabled: boolean): Promise<void>
  getStateSource(): TerminalStateSource
  isRecoveryPending(): boolean
  outputDiagnostics(): ReturnType<typeof createTerminalOutputObservation> & {
    modelSequence: number | null
  }
  subscriptionDiagnostics(): ReturnType<NonNullable<TerminalSessionTransportSubscription['snapshot']>> | null
  dispose(): void
}

function pushBounded<T>(queue: T[], value: T): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalAuthorityCoordinator({
  shellSessionKey,
  view,
  transport,
  environment,
  pty,
  attachment,
  isDisposed,
  notify,
}: TerminalAuthorityCoordinatorOptions): TerminalAuthorityCoordinator {
  const terminalOutputObservation = createTerminalOutputObservation()
  const pendingTerminalModelOutput: TerminalModelOutputEvent[] = []

  let transportSubscription: TerminalSessionTransportSubscription | null = null
  let terminalStateSource: TerminalStateSource = 'bootstrapping'
  let terminalModelSequence: number | null = null
  let outputSequence = 0
  let terminalReplayRecovery: Promise<void> | null = null

  function resetForPtyInstance(instanceId: number | null): void {
    outputSequence = 0
    terminalModelSequence = null
    pendingTerminalModelOutput.length = 0
    synchronizeTerminalOutputObservation(terminalOutputObservation, instanceId)
  }

  function writeTerminalModelOutput(event: TerminalModelOutputEvent): boolean {
    if (pty.getCurrentInstance() !== event.ptyInstanceId) return true
    const currentSequence = terminalModelSequence
    if (currentSequence === null || event.sequence <= currentSequence) return true
    if (event.startSequence !== currentSequence + 1) return false

    outputSequence += 1
    environment.performanceTrace?.mark('modelPublication', {
      terminalKey: shellSessionKey,
      ptyInstanceId: event.ptyInstanceId,
    })
    view.writeLive({
      data: event.data,
      ptyInstanceId: event.ptyInstanceId,
      sequence: outputSequence,
    })
    terminalModelSequence = event.sequence
    pty.markOutput()
    return true
  }

  function flushPendingOutput(): void {
    if (!attachment.isActive()) {
      pendingTerminalModelOutput.length = 0
      attachment.markNeedsRecovery()
      return
    }

    const pending = pendingTerminalModelOutput.splice(0)
    for (const event of pending) {
      if (!writeTerminalModelOutput(event)) {
        pushBounded(pendingTerminalModelOutput, event)
        void recoverFromAuthority()
        break
      }
    }
  }

  async function activateGhosttySnapshot(
    replay: TerminalReplay,
    renderRevision: TerminalRenderRevision | null,
  ): Promise<void> {
    terminalStateSource = 'ghostty-snapshot'
    outputSequence = 0

    if (replay.ptyInstanceId === null) {
      if (pty.getCurrentInstance() !== null) resetForPtyInstance(null)
      terminalModelSequence = null
      pendingTerminalModelOutput.length = 0
      pty.applyReplayState(replay, Boolean(replay.historicalData))
      notify()

      if (!attachment.isCurrentRenderRevision(renderRevision)) {
        attachment.markNeedsRecovery()
        return
      }
      await view.replaceSnapshot({
        data: replay.historicalData ?? '',
        ptyInstanceId: null,
        sequence: outputSequence,
      })
      attachment.finishSnapshotRender(renderRevision)
      return
    }

    const snapshot = replay.snapshot
    if (!snapshot || snapshot.ptyInstanceId !== replay.ptyInstanceId) {
      throw new Error('Ghostty-authoritative terminal state requires a current snapshot')
    }

    if (pty.getCurrentInstance() !== replay.ptyInstanceId) {
      resetForPtyInstance(replay.ptyInstanceId)
    }
    pty.applyReplayState(
      replay,
      snapshot.data.length > 0 || Boolean(snapshot.compatibilityData?.length),
    )
    terminalModelSequence = snapshot.watermark
    synchronizeTerminalOutputObservation(
      terminalOutputObservation,
      replay.ptyInstanceId,
      snapshot.watermark,
    )
    notify()

    if (!attachment.isCurrentRenderRevision(renderRevision)) {
      attachment.markNeedsRecovery()
      return
    }

    await view.replaceSnapshot({
      data: snapshot.data,
      compatibilityData: snapshot.compatibilityData,
      ptyInstanceId: replay.ptyInstanceId,
      sequence: outputSequence,
    })
    if (attachment.finishSnapshotRender(renderRevision)) flushPendingOutput()
  }

  async function recoverFromAuthority(): Promise<void> {
    if (isDisposed()) return
    if (terminalReplayRecovery) return terminalReplayRecovery

    const renderRevision = attachment.currentRenderRevision()
    const requestedInstance = pty.getCurrentInstance()
    const previousStateSource = terminalStateSource
    terminalStateSource = 'bootstrapping'

    const recovery = transport.readReplay(shellSessionKey).then((replay) => {
      if (isDisposed()) return
      const instanceChanged = pty.getCurrentInstance() !== requestedInstance
        || (requestedInstance !== null && replay.ptyInstanceId !== requestedInstance)
      if (instanceChanged) {
        terminalStateSource = previousStateSource
        flushPendingOutput()
        return
      }

      return activateGhosttySnapshot(replay, renderRevision)
    })
    terminalReplayRecovery = recovery
    try {
      await recovery
    } finally {
      if (terminalReplayRecovery === recovery) terminalReplayRecovery = null
    }
  }

  function handleTerminalModelOutput(event: TerminalModelOutputEvent): void {
    environment.performanceTrace?.mark('firstOutput', {
      terminalKey: shellSessionKey,
      ptyInstanceId: event.ptyInstanceId,
    })
    recordTerminalOutput(terminalOutputObservation, event)
    if (!attachment.isActive()) {
      if (pty.getCurrentInstance() === event.ptyInstanceId) {
        terminalModelSequence = Math.max(terminalModelSequence ?? 0, event.sequence)
        attachment.markNeedsRecovery()
        pty.markOutput()
      }
      return
    }
    if (
      pty.isSpawnPending()
      || terminalStateSource === 'bootstrapping'
      || terminalReplayRecovery !== null
    ) {
      pushBounded(pendingTerminalModelOutput, event)
      return
    }
    if (writeTerminalModelOutput(event)) return
    pushBounded(pendingTerminalModelOutput, event)
    void recoverFromAuthority()
  }

  async function start(): Promise<void> {
    const subscription = await transport.subscribeSession(shellSessionKey, {
      onModelOutput: handleTerminalModelOutput,
      onModelDisabled: event => pty.handleModelDisabled(event),
      onExit: event => pty.handleExit(event.ptyInstanceId),
    })
    if (isDisposed()) {
      subscription.dispose()
      return
    }
    transportSubscription = subscription

    await recoverFromAuthority()
    attachment.markNeedsRecovery()
  }

  function setModelOutputEnabled(enabled: boolean): Promise<void> {
    return transportSubscription?.setModelOutputEnabled(enabled) ?? Promise.resolve()
  }

  return {
    start,
    recoverFromAuthority,
    resetForPtyInstance,
    setModelOutputEnabled,
    getStateSource: () => terminalStateSource,
    isRecoveryPending: () => terminalReplayRecovery !== null,
    outputDiagnostics: () => ({
      ...terminalOutputObservation,
      modelSequence: terminalModelSequence,
    }),
    subscriptionDiagnostics: () => transportSubscription?.snapshot?.() ?? null,
    dispose: () => {
      transportSubscription?.dispose()
      transportSubscription = null
    },
  }
}
