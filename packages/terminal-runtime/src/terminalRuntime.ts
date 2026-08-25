import { get } from 'svelte/store'
import { createTerminalAcquisition } from './terminalAcquisition'
import { createTerminalAttachmentController, isValidTerminalDimensions } from './terminalAttachment'
import type { TerminalImageProtocol } from './terminalImages'
import { terminalLogMessage } from './terminalLogging'
import { preloadTerminalFonts } from './terminalOptions'
import { createTerminalReconnectReplay } from './terminalReconnectReplay'
import { createXtermTerminalView } from './xtermTerminalView'
import type {
  PoolEntry,
  TerminalRuntimeHost,
} from './terminalRuntimeTypes'
import type { TerminalViewFactory } from './terminalView'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import { applyTerminalTheme } from './terminalThemePropagation'
import { themeMode as defaultThemeMode } from './theme'

export { APP_EVENTS_RECONNECTED_EVENT } from './terminalReconnectReplay'
export type { TerminalImageProtocol } from './terminalImages'
export {
  ptyExitEventName,
  ptyOutputEventName,
  terminalModelOutputEventName,
  terminalModelDisabledEventName,
} from './terminalRuntimeTypes'
export type {
  AppEventsReconnectedPayload,
  PoolEntry,
  PtyBufferState,
  PtyExitEventPayload,
  PtyOutputEventPayload,
  TerminalModelDisabledEventPayload,
  TerminalModelOutputEventPayload,
  TerminalStateSource,
  TerminalViewSnapshot,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeEvent,
  TerminalRuntimeEventName,
  TerminalRuntimeEventPayload,
  TerminalRuntimeHost,
  TerminalRuntimeUnlistenFn,
  TerminalTab,
} from './terminalRuntimeTypes'
export type {
  TerminalView,
  TerminalViewData,
  TerminalViewLiveOutput,
  TerminalViewDisposable,
  TerminalViewFactory,
  TerminalViewFactoryOptions,
  TerminalViewGeometry,
  TerminalViewRendererFailure,
  TerminalViewTheme,
} from './terminalView'

export interface TerminalRuntimeOptions {
  createTerminalView?: TerminalViewFactory
}

export function createTerminalRuntime(
  host: TerminalRuntimeHost,
  options: TerminalRuntimeOptions = {},
) {
  const activeThemeMode = host.themeMode ?? defaultThemeMode
  const createView = options.createTerminalView ?? createXtermTerminalView
  const pool = new Map<string, PoolEntry>()
  const attachments = createTerminalAttachmentController(host)
  const sessionLifecycle = createTerminalSessionLifecycle(key => pool.get(key))

  function createEntry(terminalKey: string): PoolEntry {
    return {
      taskId: terminalKey,
      view: createView({
        terminalKey,
        themeMode: get(activeThemeMode),
        openLink: url => host.openLink(terminalKey, url),
        enableImages: host.enableImages,
        loggerName: host.loggerName,
      }),
      ptyActive: false,
      needsClear: false,
      unlisteners: [],
      viewSubscriptions: [],
      resizeObserver: null,
      visibilityObserver: null,
      resizeTimeout: null,
      attached: false,
      spawnPending: false,
      currentPtyInstance: null,
      terminalStateSource: 'bootstrapping',
      terminalModelSequence: null,
      terminalModelRejectedInstance: null,
      pendingPtyOutput: [],
      pendingTerminalModelOutput: [],
      terminalModelRecovery: null,
      hasOutput: false,
    }
  }

  function resetTerminal(entry: PoolEntry): void {
    entry.view.reset()
  }

  function disposeTerminalEntry(entry: PoolEntry): void {
    attachments.detach(entry)

    for (const unlisten of entry.unlisteners.splice(0)) {
      try {
        unlisten()
      } catch (error) {
        console.warn(
          terminalLogMessage(host.loggerName, 'Failed to remove terminal event listener:'),
          error,
        )
      }
    }

    for (const subscription of entry.viewSubscriptions.splice(0)) {
      try {
        subscription.dispose()
      } catch (error) {
        console.warn(
          terminalLogMessage(host.loggerName, 'Failed to remove terminal view listener:'),
          error,
        )
      }
    }

    entry.view.dispose()
  }

  let recoverTerminalState: ((entry: PoolEntry) => Promise<void>) | null = null
  const reconnectReplay = createTerminalReconnectReplay({
    host,
    getEntries: () => pool.values(),
    hasEntries: () => pool.size > 0,
    resetEntry: resetTerminal,
    notifyLifecycle: sessionLifecycle.notifyShellLifecycle,
    recoverEntry: entry => recoverTerminalState?.(entry) ?? Promise.resolve(),
  })
  const acquisition = createTerminalAcquisition({
    host,
    pool,
    createEntry,
    preloadEntry: preloadTerminalFonts,
    disposeEntry: disposeTerminalEntry,
    resetEntry: resetTerminal,
    lifecycle: sessionLifecycle,
    reconnectReplay,
  })
  recoverTerminalState = acquisition.recoverTerminalState

  const unsubscribeThemeMode = activeThemeMode.subscribe(mode => applyTerminalTheme(pool.values(), mode))

  function dispose(): void {
    try {
      releaseAll()
    } finally {
      unsubscribeThemeMode()
    }
  }

  function releaseAll(): void {
    acquisition.releaseAll()
    sessionLifecycle.clearAll()
    reconnectReplay.releaseListenerIfIdle()
  }

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
    return entry.view.imageProtocol
  }

  function _getPool(): Map<string, PoolEntry> {
    return pool
  }

  return {
    isValidTerminalDimensions,
    getTerminalImageProtocol,
    acquire: acquisition.acquire,
    attach: attachments.attach,
    detach: attachments.detach,
    release: acquisition.release,
    resetTerminal,
    shouldSpawnPty: sessionLifecycle.shouldSpawnPty,
    markPtySpawnPending: sessionLifecycle.markPtySpawnPending,
    clearPtySpawnPending: sessionLifecycle.clearPtySpawnPending,
    setCurrentPtyInstance: sessionLifecycle.setCurrentPtyInstance,
    restorePtyInstance: sessionLifecycle.restorePtyInstance,
    markShellPtyStarted: sessionLifecycle.markPtyStarted,
    subscribeShellLifecycle: sessionLifecycle.subscribeShellLifecycle,
    isShellExited: sessionLifecycle.isShellExited,
    getShellLifecycleState: sessionLifecycle.getShellLifecycleState,
    updateShellLifecycleState: sessionLifecycle.updateShellLifecycleState,
    getTaskTerminalTabsSession: sessionLifecycle.getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession: sessionLifecycle.updateTaskTerminalTabsSession,
    clearTaskTerminalTabsSession: sessionLifecycle.clearTaskTerminalTabsSession,
    releaseAll,
    dispose,
    releaseAllForTask: acquisition.releaseAllForTask,
    focusTerminal,
    hasTerminal,
    isPtyActive,
    recoverActiveTerminal: attachments.recoverActiveTerminal,
    replayPtyBuffersForActiveTerminals: reconnectReplay.replayActiveTerminals,
    _getPool,
  }
}

export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>
