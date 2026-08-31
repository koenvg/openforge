import { parsePtySessionKey } from './ptySessionKey'
import type { TerminalFontReadiness } from './terminalOptions'
import type {
  TerminalSessionCoordinator,
} from './terminalSessionCoordinator'
import type { TerminalSession, TerminalSessionDiagnostics } from './terminalRuntimeTypes'

interface TerminalAcquisitionOperation {
  released: boolean
  coordinator: TerminalSessionCoordinator | null
}

interface PendingTerminalAcquisition {
  operation: TerminalAcquisitionOperation
  promise: Promise<TerminalSession>
}

interface TerminalAcquisitionLifecycle {
  applyRestoredPtyInstance(coordinator: TerminalSessionCoordinator): Promise<void>
  clearTerminal(shellSessionKey: string): void
}

interface TerminalAcquisitionReconnectReplay {
  releaseListenerIfIdle(): void
  retainListener(): Promise<void>
}

interface TerminalAcquisitionOptions {
  coordinators: Map<string, TerminalSessionCoordinator>
  createCoordinator(
    shellSessionKey: string,
    fontReadiness: TerminalFontReadiness,
  ): TerminalSessionCoordinator
  beforeSessionStart?(
    session: TerminalSession,
    getDiagnostics: () => TerminalSessionDiagnostics,
  ): Promise<void> | undefined
  preloadEntry(): Promise<TerminalFontReadiness>
  lifecycle: TerminalAcquisitionLifecycle
  reconnectReplay: TerminalAcquisitionReconnectReplay
}

export function createTerminalAcquisition({
  coordinators,
  createCoordinator,
  beforeSessionStart,
  preloadEntry,
  lifecycle,
  reconnectReplay,
}: TerminalAcquisitionOptions) {
  const pendingAcquisitions = new Map<string, PendingTerminalAcquisition>()

  function disposeReleasedAcquisition(operation: TerminalAcquisitionOperation): boolean {
    if (!operation.released) return false
    operation.coordinator?.dispose()
    operation.coordinator = null
    return true
  }

  async function initializeTerminal(
    shellSessionKey: string,
    operation: TerminalAcquisitionOperation,
  ): Promise<TerminalSession> {
    const fontReadiness = await preloadEntry()
    const coordinator = createCoordinator(shellSessionKey, fontReadiness)
    operation.coordinator = coordinator
    const checkpoint = beforeSessionStart?.(coordinator.session, () => coordinator.diagnostics())
    if (checkpoint) void checkpoint.catch(() => undefined)
    if (operation.released) {
      if (checkpoint) await checkpoint
      disposeReleasedAcquisition(operation)
      return coordinator.session
    }

    await coordinator.start()
    if (checkpoint) await checkpoint
    if (disposeReleasedAcquisition(operation)) return coordinator.session

    coordinators.set(shellSessionKey, coordinator)
    await lifecycle.applyRestoredPtyInstance(coordinator)
    if (disposeReleasedAcquisition(operation)) {
      if (coordinators.get(shellSessionKey) === coordinator) coordinators.delete(shellSessionKey)
      return coordinator.session
    }

    await reconnectReplay.retainListener()
    return coordinator.session
  }

  function rollbackFailedAcquisition(
    shellSessionKey: string,
    operation: TerminalAcquisitionOperation,
  ): void {
    const coordinator = operation.coordinator
    if (!coordinator) return
    if (coordinators.get(shellSessionKey) === coordinator) coordinators.delete(shellSessionKey)
    operation.coordinator = null
    try {
      coordinator.dispose()
    } finally {
      reconnectReplay.releaseListenerIfIdle()
    }
  }

  function acquire(shellSessionKey: string): Promise<TerminalSession> {
    const pendingAcquisition = pendingAcquisitions.get(shellSessionKey)
    if (pendingAcquisition) return pendingAcquisition.promise

    const existing = coordinators.get(shellSessionKey)
    if (existing) return Promise.resolve(existing.session)

    const operation: TerminalAcquisitionOperation = { released: false, coordinator: null }
    const promise = initializeTerminal(shellSessionKey, operation).catch((error: unknown) => {
      rollbackFailedAcquisition(shellSessionKey, operation)
      throw error
    })
    const acquisition: PendingTerminalAcquisition = { operation, promise }
    pendingAcquisitions.set(shellSessionKey, acquisition)

    const clearPendingAcquisition = () => {
      if (pendingAcquisitions.get(shellSessionKey) === acquisition) {
        pendingAcquisitions.delete(shellSessionKey)
      }
    }
    void promise.then(clearPendingAcquisition, clearPendingAcquisition)
    return promise
  }

  function release(shellSessionKey: string): void {
    const pendingAcquisition = pendingAcquisitions.get(shellSessionKey)
    if (pendingAcquisition) {
      pendingAcquisition.operation.released = true
      pendingAcquisitions.delete(shellSessionKey)
    }

    const pooledCoordinator = coordinators.get(shellSessionKey)
    const pendingCoordinator = pendingAcquisition?.operation.coordinator ?? null
    coordinators.delete(shellSessionKey)
    if (pendingAcquisition) pendingAcquisition.operation.coordinator = null

    let releaseError: unknown = null
    try {
      if (pooledCoordinator) pooledCoordinator.dispose()
      else pendingCoordinator?.dispose()
    } catch (error) {
      releaseError = error
    }
    try {
      lifecycle.clearTerminal(shellSessionKey)
    } catch (error) {
      releaseError ??= error
    }
    try {
      reconnectReplay.releaseListenerIfIdle()
    } catch (error) {
      releaseError ??= error
    }
    if (releaseError) throw releaseError
  }

  function releaseTerminalKeys(shellSessionKeys: Iterable<string>): void {
    let releaseError: unknown = null
    for (const shellSessionKey of shellSessionKeys) {
      try {
        release(shellSessionKey)
      } catch (error) {
        releaseError ??= error
      }
    }
    if (releaseError) throw releaseError
  }

  function releaseAll(): void {
    releaseTerminalKeys(new Set([...coordinators.keys(), ...pendingAcquisitions.keys()]))
  }

  function releaseAllForTask(taskId: string): number {
    const keysToRelease = new Set<string>()
    for (const key of [...coordinators.keys(), ...pendingAcquisitions.keys()]) {
      const parsed = parsePtySessionKey(key)
      if (parsed.kind === 'indexed-shell' && parsed.taskId === taskId) keysToRelease.add(key)
    }
    releaseTerminalKeys(keysToRelease)
    return keysToRelease.size
  }

  return { acquire, release, releaseAll, releaseAllForTask }
}
