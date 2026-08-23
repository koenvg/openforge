import { get } from 'svelte/store'
import { createTaskTerminalTabsSessionStore } from './taskTerminalTabsSession'
import { terminalLogMessage } from './terminalLogging'
import { createTerminalAttachmentController, isValidTerminalDimensions } from './terminalAttachment'
import type { TerminalImageProtocol } from './terminalImages'
import {
  createTerminalEntry,
  disposeWebglContextLossListener,
  resetTerminal,
} from './terminalRendering'
import type {
  PoolEntry,
  PtyEvent,
  ShellLifecycleListener,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeHost,
  TerminalRuntimeUnlistenFn,
} from './terminalRuntimeTypes'
import { createTerminalShellLifecycleStore } from './terminalShellLifecycle'
import { applyTerminalTheme } from './terminalThemePropagation'
import { preloadTerminalFonts } from './terminalOptions'
import { themeMode as defaultThemeMode } from './theme'

export type { TerminalImageProtocol } from './terminalImages'
export type {
  PoolEntry,
  PtyBufferState,
  PtyEvent,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeEvent,
  TerminalRuntimeHost,
  TerminalRuntimeUnlistenFn,
  TerminalTab,
} from './terminalRuntimeTypes'

interface TerminalAcquisition {
  released: boolean
  entry: PoolEntry | null
}

interface PendingTerminalAcquisition {
  operation: TerminalAcquisition
  promise: Promise<PoolEntry>
}

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

export function createTerminalRuntime(host: TerminalRuntimeHost) {
  const activeThemeMode = host.themeMode ?? defaultThemeMode
  const pool = new Map<string, PoolEntry>()
  const pendingAcquisitions = new Map<string, PendingTerminalAcquisition>()
  const pendingPtyInstances = new Map<string, number>()
  const taskTabSessions = createTaskTerminalTabsSessionStore()
  const shellLifecycle = createTerminalShellLifecycleStore(key => pool.get(key))
  const attachments = createTerminalAttachmentController(host)
  let appEventsReconnectUnlisten: TerminalRuntimeUnlistenFn | null = null
  let appEventsReconnectListenerPending: Promise<void> | null = null

  function markShellPtyExited(entry: PoolEntry): void {
    entry.ptyActive = false
    entry.needsClear = true
    shellLifecycle.notify(entry.taskId)
  }

  function isShellTerminalKey(terminalKey: string): boolean {
    return /-shell-\d+$/.test(terminalKey)
  }

  function attachAgentTerminalKeyHandler(entry: PoolEntry): void {
    if (isShellTerminalKey(entry.taskId)) return

    entry.terminal.attachCustomKeyEventHandler((event) => {
      const isShiftEnter = event.key === 'Enter' && event.shiftKey
      const shouldConsume = isShiftEnter && (event.type === 'keydown' || event.type === 'keypress')
      if (!shouldConsume) return true

      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && entry.ptyActive) {
        host.writePty(entry.taskId, '\n').catch(error => {
          console.error(terminalLogMessage(host.loggerName, 'write failed:'), error)
        })
      }
      return false
    })
  }

  async function replayPtyBuffer(entry: PoolEntry): Promise<void> {
    if (entry.needsClear) return

    try {
      const { buffer, isLive } = await host.getPtyBuffer(entry.taskId)
      entry.ptyActive = isLive
      if (!buffer) {
        shellLifecycle.notify(entry.taskId)
        return
      }

      resetTerminal(entry)
      entry.needsClear = false
      entry.terminal.write(buffer)
      entry.hasOutput = true
      shellLifecycle.notify(entry.taskId)
      if (entry.attached) entry.terminal.refresh(0, (entry.terminal.rows ?? 1) - 1)
    } catch (error) {
      console.error(terminalLogMessage(host.loggerName, 'Failed to replay PTY buffer after app event reconnect:'), error)
    }
  }

  async function replayPtyBuffersForActiveTerminals(): Promise<void> {
    await Promise.all([...pool.values()].map(entry => replayPtyBuffer(entry)))
  }

  async function ensureAppEventsReconnectListener(): Promise<void> {
    if (appEventsReconnectUnlisten) return
    if (appEventsReconnectListenerPending) return appEventsReconnectListenerPending

    appEventsReconnectListenerPending = host.listenEvent(APP_EVENTS_RECONNECTED_EVENT, () => {
      void replayPtyBuffersForActiveTerminals()
    })
      .then((unlisten) => {
        if (pool.size === 0) {
          unlisten()
          return
        }
        appEventsReconnectUnlisten = unlisten
      })
      .finally(() => {
        appEventsReconnectListenerPending = null
      })

    return appEventsReconnectListenerPending
  }

  function releaseAppEventsReconnectListenerIfIdle(): void {
    if (pool.size > 0) return
    appEventsReconnectUnlisten?.()
    appEventsReconnectUnlisten = null
  }

  function disposeTerminalEntry(entry: PoolEntry): void {
    attachments.detach(entry)

    for (const unlisten of entry.unlisteners.splice(0)) {
      try {
        unlisten()
      } catch (error) {
        console.warn(terminalLogMessage(host.loggerName, 'Failed to remove terminal event listener:'), error)
      }
    }

    disposeWebglContextLossListener(entry)
    entry.terminal.dispose()
  }

  function disposeReleasedAcquisition(acquisition: TerminalAcquisition): boolean {
    if (!acquisition.released) return false
    if (acquisition.entry) {
      disposeTerminalEntry(acquisition.entry)
      acquisition.entry = null
    }
    return true
  }

  async function retainAcquisitionListener(
    acquisition: TerminalAcquisition,
    entry: PoolEntry,
    listenerRegistration: Promise<TerminalRuntimeUnlistenFn>,
  ): Promise<boolean> {
    const unlisten = await listenerRegistration
    if (acquisition.released) {
      unlisten()
      return false
    }
    entry.unlisteners.push(unlisten)
    return true
  }

  async function initializeTerminal(terminalKey: string, acquisition: TerminalAcquisition): Promise<PoolEntry> {
    const entry = createTerminalEntry(host, terminalKey, get(activeThemeMode))
    acquisition.entry = entry

    // terminal.open() remains deferred until attach() gives xterm measurable DOM dimensions.
    await preloadTerminalFonts()
    if (disposeReleasedAcquisition(acquisition)) return entry

    try {
      const { buffer, isLive } = await host.getPtyBuffer(terminalKey)
      entry.ptyActive = isLive
      if (buffer) {
        entry.terminal.write(buffer)
        entry.hasOutput = true
      }
    } catch (error) {
      console.error(terminalLogMessage(host.loggerName, 'Failed to get PTY buffer:'), error)
    }
    if (disposeReleasedAcquisition(acquisition)) return entry

    const outputListenerRetained = await retainAcquisitionListener(
      acquisition,
      entry,
      host.listenEvent<PtyEvent>(`pty-output-${terminalKey}`, (event) => {
        const instanceId = event.payload.instance_id
        if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) return
        if (!event.payload.data) return

        if (entry.needsClear) {
          resetTerminal(entry)
          entry.needsClear = false
        }
        entry.terminal.write(event.payload.data)
        entry.ptyActive = true
        entry.hasOutput = true
        shellLifecycle.notify(terminalKey)
      }),
    )
    if (!outputListenerRetained || disposeReleasedAcquisition(acquisition)) return entry

    const exitListenerRetained = await retainAcquisitionListener(
      acquisition,
      entry,
      host.listenEvent<PtyEvent>(`pty-exit-${terminalKey}`, (event) => {
        const instanceId = event.payload.instance_id
        if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) return
        markShellPtyExited(entry)
      }),
    )
    if (!exitListenerRetained || disposeReleasedAcquisition(acquisition)) return entry

    attachAgentTerminalKeyHandler(entry)
    entry.terminal.onData((data: string) => {
      if (entry.ptyActive) {
        host.writePty(terminalKey, data).catch(error => {
          console.error(terminalLogMessage(host.loggerName, 'write failed:'), error)
        })
      }
    })

    pool.set(terminalKey, entry)
    const restoredPtyInstance = pendingPtyInstances.get(terminalKey)
    if (restoredPtyInstance !== undefined) {
      pendingPtyInstances.delete(terminalKey)
      markShellPtyStarted(entry, restoredPtyInstance)
    }
    await ensureAppEventsReconnectListener()
    return entry
  }

  function rollbackFailedAcquisition(terminalKey: string, acquisition: TerminalAcquisition): void {
    const entry = acquisition.entry
    if (!entry) return
    if (pool.get(terminalKey) === entry) pool.delete(terminalKey)
    acquisition.entry = null

    try {
      disposeTerminalEntry(entry)
    } catch (cleanupError) {
      console.warn(terminalLogMessage(host.loggerName, 'Failed to fully dispose terminal after initialization failure:'), cleanupError)
    } finally {
      releaseAppEventsReconnectListenerIfIdle()
    }
  }

  function acquire(terminalKey: string): Promise<PoolEntry> {
    const pendingAcquisition = pendingAcquisitions.get(terminalKey)
    if (pendingAcquisition) return pendingAcquisition.promise

    const existing = pool.get(terminalKey)
    if (existing) return Promise.resolve(existing)

    const operation: TerminalAcquisition = { released: false, entry: null }
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
      disposeTerminalEntry(pooledEntry)
      pool.delete(terminalKey)
    } else if (pendingEntry) {
      disposeTerminalEntry(pendingEntry)
    }

    if (pendingAcquisition) pendingAcquisition.operation.entry = null
    pendingPtyInstances.delete(terminalKey)
    shellLifecycle.clear(terminalKey)
    releaseAppEventsReconnectListenerIfIdle()
  }

  function shouldSpawnPty(entry: PoolEntry): boolean {
    return !entry.ptyActive && !entry.spawnPending && !entry.needsClear
  }

  function markPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = true
    entry.hasOutput = false
  }

  function clearPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = false
  }

  function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
    entry.currentPtyInstance = instanceId
  }

  function restorePtyInstance(terminalKey: string, instanceId: number): void {
    const entry = pool.get(terminalKey)
    if (!entry) {
      pendingPtyInstances.set(terminalKey, instanceId)
      return
    }
    markShellPtyStarted(entry, instanceId)
  }

  function markShellPtyStarted(entry: PoolEntry, instanceId: number): void {
    entry.currentPtyInstance = instanceId
    entry.ptyActive = true
    entry.needsClear = false
    shellLifecycle.notify(entry.taskId)
  }

  function subscribeShellLifecycle(
    terminalKey: string,
    listener: ShellLifecycleListener,
  ): TerminalRuntimeUnlistenFn {
    return shellLifecycle.subscribe(terminalKey, listener)
  }

  function isShellExited(terminalKey: string): boolean {
    const entry = pool.get(terminalKey)
    return entry ? !entry.ptyActive && entry.needsClear : false
  }

  function getShellLifecycleState(terminalKey: string): ShellLifecycleState {
    return shellLifecycle.getState(terminalKey)
  }

  function updateShellLifecycleState(terminalKey: string, state: ShellLifecycleState): void {
    const entry = pool.get(terminalKey)
    if (!entry) return
    entry.ptyActive = state.ptyActive
    entry.needsClear = state.shellExited
    entry.currentPtyInstance = state.currentPtyInstance
    entry.hasOutput = state.hasOutput
    shellLifecycle.notify(terminalKey)
  }

  function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
    return taskTabSessions.get(taskId)
  }

  function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
    taskTabSessions.update(taskId, session)
  }

  function clearTaskTerminalTabsSession(taskId: string): void {
    taskTabSessions.clear(taskId)
  }

  function releaseAll(): void {
    const terminalKeys = new Set([...pool.keys(), ...pendingAcquisitions.keys()])
    for (const terminalKey of terminalKeys) release(terminalKey)
    taskTabSessions.clearAll()
    shellLifecycle.clearAll()
    releaseAppEventsReconnectListenerIfIdle()
  }

  function releaseAllForTask(taskId: string): number {
    const keysToRelease = new Set<string>()
    for (const key of [...pool.keys(), ...pendingAcquisitions.keys()]) {
      if (key.startsWith(`${taskId}-shell-`)) keysToRelease.add(key)
    }
    for (const key of keysToRelease) release(key)
    return keysToRelease.size
  }

  activeThemeMode.subscribe(mode => applyTerminalTheme(pool.values(), mode))

  function focusTerminal(terminalKey: string): void {
    attachments.focus(pool.get(terminalKey))
  }

  function hasTerminal(terminalKey: string): boolean {
    return pool.has(terminalKey)
  }

  function isPtyActive(terminalKey: string): boolean {
    return pool.get(terminalKey)?.ptyActive ?? false
  }

  function getTerminalImageProtocol(entry: PoolEntry): TerminalImageProtocol | null {
    return entry.imageProtocol
  }

  function _getPool(): Map<string, PoolEntry> {
    return pool
  }

  return {
    isValidTerminalDimensions,
    getTerminalImageProtocol,
    acquire,
    attach: attachments.attach,
    detach: attachments.detach,
    release,
    resetTerminal,
    shouldSpawnPty,
    markPtySpawnPending,
    clearPtySpawnPending,
    setCurrentPtyInstance,
    restorePtyInstance,
    markShellPtyStarted,
    subscribeShellLifecycle,
    isShellExited,
    getShellLifecycleState,
    updateShellLifecycleState,
    getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession,
    clearTaskTerminalTabsSession,
    releaseAll,
    releaseAllForTask,
    focusTerminal,
    hasTerminal,
    isPtyActive,
    recoverActiveTerminal: attachments.recoverActiveTerminal,
    replayPtyBuffersForActiveTerminals,
    _getPool,
  }
}

export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>
