import { parsePtySessionKey } from './ptySessionKey'
import { terminalLogMessage } from './terminalLogging'
import type { TerminalFontReadiness } from './terminalOptions'
import { createTerminalStateView } from './terminalStateView'
import type {
  TerminalSessionTransportSubscription,
  TerminalTransport,
} from './terminalTransport'
import type { PoolEntry, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'

interface TerminalAcquisitionOperation {
  released: boolean
  entry: PoolEntry | null
}

interface PendingTerminalAcquisition {
  operation: TerminalAcquisitionOperation
  promise: Promise<PoolEntry>
}

interface TerminalAcquisitionLifecycle {
  applyRestoredPtyInstance(entry: PoolEntry): void
  clearTerminal(terminalKey: string): void
  markPtyExited(entry: PoolEntry): void
  markPtyOutput(entry: PoolEntry): void
}

interface TerminalAcquisitionReconnectReplay {
  releaseListenerIfIdle(): void
  retainListener(): Promise<void>
}

interface TerminalAcquisitionOptions {
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  pool: Map<string, PoolEntry>
  createEntry(terminalKey: string, fontReadiness: TerminalFontReadiness): PoolEntry
  preloadEntry(): Promise<TerminalFontReadiness>
  disposeEntry(entry: PoolEntry): void
  lifecycle: TerminalAcquisitionLifecycle
  reconnectReplay: TerminalAcquisitionReconnectReplay
}

export function createTerminalAcquisition({
  transport,
  environment,
  pool,
  createEntry,
  preloadEntry,
  disposeEntry,
  lifecycle,
  reconnectReplay,
}: TerminalAcquisitionOptions) {
  const pendingAcquisitions = new Map<string, PendingTerminalAcquisition>()
  const terminalStateView = createTerminalStateView({
    transport,
    markOutput: lifecycle.markPtyOutput,
    getPerformanceTrace: () => environment.performanceTrace,
  })

  function attachAgentTerminalKeyHandler(entry: PoolEntry): void {
    if (parsePtySessionKey(entry.shellSessionKey).kind === 'indexed-shell') return

    entry.view.setKeyEventHandler((event) => {
      const isShiftEnter = event.key === 'Enter' && event.shiftKey
      const shouldConsume = isShiftEnter && (event.type === 'keydown' || event.type === 'keypress')
      if (!shouldConsume) return true

      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && entry.ptyActive) {
        transport.writeUserInput(entry.shellSessionKey, '\n').catch(error => {
          console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
        })
      }
      return false
    })
  }

  function disposeReleasedAcquisition(operation: TerminalAcquisitionOperation): boolean {
    if (!operation.released) return false
    if (operation.entry) {
      disposeEntry(operation.entry)
      operation.entry = null
    }
    return true
  }

  async function retainSessionSubscription(
    operation: TerminalAcquisitionOperation,
    entry: PoolEntry,
    registration: Promise<TerminalSessionTransportSubscription>,
  ): Promise<boolean> {
    const subscription = await registration
    if (operation.released) {
      subscription.dispose()
      return false
    }
    entry.transportSubscription = subscription
    return true
  }

  async function initializeTerminal(
    terminalKey: string,
    operation: TerminalAcquisitionOperation,
  ): Promise<PoolEntry> {
    const fontReadiness = await preloadEntry()
    const entry = createEntry(terminalKey, fontReadiness)
    operation.entry = entry
    if (disposeReleasedAcquisition(operation)) return entry

    const subscriptionRetained = await retainSessionSubscription(
      operation,
      entry,
      transport.subscribeSession(terminalKey, {
        onModelOutput: event => terminalStateView.handleTerminalModelOutput(entry, event),
        onModelDisabled: event => terminalStateView.handleTerminalModelDisabled(entry, event),
        onExit: event => {
          if (entry.currentPtyInstance !== null
            && event.ptyInstanceId !== entry.currentPtyInstance) return
          lifecycle.markPtyExited(entry)
        },
      }),
    )
    if (!subscriptionRetained || disposeReleasedAcquisition(operation)) return entry

    await terminalStateView.recover(entry)
    entry.viewNeedsRecovery = true
    if (disposeReleasedAcquisition(operation)) return entry

    attachAgentTerminalKeyHandler(entry)
    entry.viewSubscriptions.push(entry.view.onUserInput((data: string) => {
      if (!entry.ptyActive) return
      environment.performanceTrace?.mark('inputAcceptance', {
        terminalKey,
        ptyInstanceId: entry.currentPtyInstance,
      })
      transport.writeUserInput(terminalKey, data).catch(error => {
        console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
      })
    }))

    pool.set(terminalKey, entry)
    lifecycle.applyRestoredPtyInstance(entry)
    await reconnectReplay.retainListener()
    return entry
  }

  function rollbackFailedAcquisition(
    terminalKey: string,
    operation: TerminalAcquisitionOperation,
  ): void {
    const entry = operation.entry
    if (!entry) return
    if (pool.get(terminalKey) === entry) pool.delete(terminalKey)
    operation.entry = null

    try {
      disposeEntry(entry)
    } catch (cleanupError) {
      console.warn(
        terminalLogMessage(environment.loggerName, 'Failed to fully dispose terminal after initialization failure:'),
        cleanupError,
      )
    } finally {
      reconnectReplay.releaseListenerIfIdle()
    }
  }

  function acquire(terminalKey: string): Promise<PoolEntry> {
    const pendingAcquisition = pendingAcquisitions.get(terminalKey)
    if (pendingAcquisition) return pendingAcquisition.promise

    const existing = pool.get(terminalKey)
    if (existing) return Promise.resolve(existing)

    const operation: TerminalAcquisitionOperation = { released: false, entry: null }
    const promise = initializeTerminal(terminalKey, operation).catch((error: unknown) => {
      rollbackFailedAcquisition(terminalKey, operation)
      throw error
    })
    const acquisition: PendingTerminalAcquisition = { operation, promise }
    pendingAcquisitions.set(terminalKey, acquisition)

    const clearPendingAcquisition = () => {
      if (pendingAcquisitions.get(terminalKey) === acquisition) pendingAcquisitions.delete(terminalKey)
    }
    void promise.then(clearPendingAcquisition, clearPendingAcquisition)
    return promise
  }

  function release(terminalKey: string): void {
    const pendingAcquisition = pendingAcquisitions.get(terminalKey)
    if (pendingAcquisition) {
      pendingAcquisition.operation.released = true
      pendingAcquisitions.delete(terminalKey)
    }

    const pooledEntry = pool.get(terminalKey)
    const pendingEntry = pendingAcquisition?.operation.entry ?? null
    pool.delete(terminalKey)
    if (pendingAcquisition) pendingAcquisition.operation.entry = null

    let releaseError: unknown = null
    try {
      if (pooledEntry) disposeEntry(pooledEntry)
      else if (pendingEntry) disposeEntry(pendingEntry)
    } catch (error) {
      releaseError = error
    }
    try {
      lifecycle.clearTerminal(terminalKey)
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

  function releaseTerminalKeys(terminalKeys: Iterable<string>): void {
    let releaseError: unknown = null
    for (const terminalKey of terminalKeys) {
      try {
        release(terminalKey)
      } catch (error) {
        releaseError ??= error
      }
    }
    if (releaseError) throw releaseError
  }

  function releaseAll(): void {
    releaseTerminalKeys(new Set([...pool.keys(), ...pendingAcquisitions.keys()]))
  }

  function releaseAllForTask(taskId: string): number {
    const keysToRelease = new Set<string>()
    for (const key of [...pool.keys(), ...pendingAcquisitions.keys()]) {
      const parsed = parsePtySessionKey(key)
      if (parsed.kind === 'indexed-shell' && parsed.taskId === taskId) keysToRelease.add(key)
    }
    releaseTerminalKeys(keysToRelease)
    return keysToRelease.size
  }

  return {
    acquire,
    recoverTerminalState: (entry: PoolEntry) => terminalStateView.recover(entry),
    flushPendingOutput: (entry: PoolEntry) => terminalStateView.flushPendingOutput(entry),
    release,
    releaseAll,
    releaseAllForTask,
  }
}
