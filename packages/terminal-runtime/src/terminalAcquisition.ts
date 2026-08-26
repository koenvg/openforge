import { parsePtySessionKey } from './ptySessionKey'
import type { TerminalAuthorityContract } from './terminalAuthority'
import { terminalLogMessage } from './terminalLogging'
import { createTerminalStateView } from './terminalStateView'
import {
  ptyExitEventName,
  ptyOutputEventName,
  type PoolEntry,
  type TerminalRuntimeHost,
  type TerminalRuntimeUnlistenFn,
} from './terminalRuntimeTypes'

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
  host: TerminalRuntimeHost
  authority: TerminalAuthorityContract
  pool: Map<string, PoolEntry>
  createEntry(terminalKey: string): PoolEntry
  preloadEntry(): Promise<void>
  disposeEntry(entry: PoolEntry): void
  resetEntry(entry: PoolEntry): void
  lifecycle: TerminalAcquisitionLifecycle
  reconnectReplay: TerminalAcquisitionReconnectReplay
}

export function createTerminalAcquisition({
  host,
  authority,
  pool,
  createEntry,
  preloadEntry,
  disposeEntry,
  resetEntry,
  lifecycle,
  reconnectReplay,
}: TerminalAcquisitionOptions) {
  const pendingAcquisitions = new Map<string, PendingTerminalAcquisition>()
  const terminalStateView = createTerminalStateView({
    host,
    authority,
    resetEntry,
    markOutput: lifecycle.markPtyOutput,
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
        host.writePty(entry.shellSessionKey, '\n').catch(error => {
          console.error(terminalLogMessage(host.loggerName, 'write failed:'), error)
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

  async function retainAcquisitionListener(
    operation: TerminalAcquisitionOperation,
    entry: PoolEntry,
    listenerRegistration: Promise<TerminalRuntimeUnlistenFn>,
  ): Promise<boolean> {
    const unlisten = await listenerRegistration
    if (operation.released) {
      unlisten()
      return false
    }
    entry.unlisteners.push(unlisten)
    return true
  }

  async function initializeTerminal(
    terminalKey: string,
    operation: TerminalAcquisitionOperation,
  ): Promise<PoolEntry> {
    const entry = createEntry(terminalKey)
    operation.entry = entry

    await preloadEntry()
    if (disposeReleasedAcquisition(operation)) return entry

    const outputListenerRetained = await retainAcquisitionListener(
      operation,
      entry,
      host.listenEvent(ptyOutputEventName(terminalKey), (event) => {
        terminalStateView.handlePtyOutput(entry, event.payload)
      }),
    )
    if (!outputListenerRetained || disposeReleasedAcquisition(operation)) return entry

    const exitListenerRetained = await retainAcquisitionListener(
      operation,
      entry,
      host.listenEvent(ptyExitEventName(terminalKey), (event) => {
        const instanceId = event.payload.instance_id
        if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) return
        lifecycle.markPtyExited(entry)
      }),
    )
    if (!exitListenerRetained || disposeReleasedAcquisition(operation)) return entry

    try {
      await terminalStateView.recover(entry, false)
    } catch (error) {
      console.error(terminalLogMessage(host.loggerName, 'Failed to get PTY buffer:'), error)
    }
    if (disposeReleasedAcquisition(operation)) return entry

    attachAgentTerminalKeyHandler(entry)
    entry.viewSubscriptions.push(entry.view.onUserInput((data: string) => {
      if (!entry.ptyActive) return
      host.writePty(terminalKey, data).catch(error => {
        console.error(terminalLogMessage(host.loggerName, 'write failed:'), error)
      })
    }))
    entry.viewSubscriptions.push(entry.view.onQueryResponse((response) => {
      const binding = entry.authority
      if (!entry.ptyActive
        || !binding
        || binding.contract.queryResponseOwner !== 'xterm'
        || response.ptyInstanceId !== binding.ptyInstanceId) return
      host.writeTerminalQueryResponse({
        shellSessionKey: binding.shellSessionKey,
        ptyInstanceId: binding.ptyInstanceId,
        data: response.data,
      }).catch(error => {
        console.error(terminalLogMessage(host.loggerName, 'query response write failed:'), error)
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
        terminalLogMessage(host.loggerName, 'Failed to fully dispose terminal after initialization failure:'),
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
    if (pooledEntry) {
      disposeEntry(pooledEntry)
      pool.delete(terminalKey)
    } else if (pendingEntry) {
      disposeEntry(pendingEntry)
    }

    if (pendingAcquisition) pendingAcquisition.operation.entry = null
    lifecycle.clearTerminal(terminalKey)
    reconnectReplay.releaseListenerIfIdle()
  }

  function releaseAll(): void {
    const terminalKeys = new Set([...pool.keys(), ...pendingAcquisitions.keys()])
    for (const terminalKey of terminalKeys) release(terminalKey)
  }

  function releaseAllForTask(taskId: string): number {
    const keysToRelease = new Set<string>()
    for (const key of [...pool.keys(), ...pendingAcquisitions.keys()]) {
      const parsed = parsePtySessionKey(key)
      if (parsed.kind === 'indexed-shell' && parsed.taskId === taskId) keysToRelease.add(key)
    }
    for (const key of keysToRelease) release(key)
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
