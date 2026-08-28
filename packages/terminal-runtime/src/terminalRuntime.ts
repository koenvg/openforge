import { get } from 'svelte/store'
import { createTerminalAcquisition } from './terminalAcquisition'
import { createTerminalAttachmentController, isValidTerminalDimensions } from './terminalAttachment'
import type { TerminalImageProtocol } from './terminalImages'
import { terminalLogMessage } from './terminalLogging'
import { preloadTerminalFonts, type TerminalFontReadiness } from './terminalOptions'
import { createTerminalReconnectReplay } from './terminalReconnectReplay'
import type { TerminalTransport } from './terminalTransport'
import { createXtermTerminalView } from './xtermTerminalView'
import type { PoolEntry, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'
import type { TerminalViewFactory } from './terminalView'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import { applyTerminalTheme } from './terminalThemePropagation'
import { themeMode as defaultThemeMode } from './theme'

export type { TerminalViewAttachment } from './terminalAttachment'
export type { TerminalImageProtocol } from './terminalImages'
export type {
  TerminalExitEvent,
  TerminalGeometry,
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalSnapshot,
  TerminalSessionTransportHandlers,
  TerminalTransport,
  TerminalTransportDisposable,
} from './terminalTransport'
export type {
  PoolEntry,
  TerminalStateSource,
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeEnvironment,
  TerminalSessionConfiguration,
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
  TerminalViewPresentationCell,
  TerminalViewPresentationEvidence,
  TerminalViewPresentationLine,
  TerminalViewPresentationSnapshot,
  TerminalViewRendererFailure,
  TerminalViewTheme,
} from './terminalView'

export interface TerminalRuntimeOptions {
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  createTerminalView?: TerminalViewFactory
}

export function createTerminalRuntime({
  transport,
  environment,
  createTerminalView = createXtermTerminalView,
}: TerminalRuntimeOptions) {
  const activeThemeMode = environment.themeMode ?? defaultThemeMode
  const pool = new Map<string, PoolEntry>()
  const attachments = createTerminalAttachmentController(transport, environment)
  const sessionLifecycle = createTerminalSessionLifecycle(key => pool.get(key))

  function createEntry(terminalKey: string, fontReadiness: TerminalFontReadiness): PoolEntry {
    const configuration = environment.sampleSessionConfiguration?.(terminalKey) ?? {
      renderer: 'xterm' as const,
      enableImages: environment.enableImages,
    }
    return {
      shellSessionKey: terminalKey,
      view: createTerminalView({
        terminalKey,
        themeMode: get(activeThemeMode),
        openLink: url => environment.openLink(url),
        enableImages: configuration.enableImages,
        loggerName: environment.loggerName,
        fontReadiness,
      }),
      ptyActive: false,
      needsClear: false,
      shellExited: false,
      transportSubscription: null,
      viewSubscriptions: [],
      resizeObserver: null,
      visibilityObserver: null,
      resizeTimeout: null,
      attached: false,
      attachmentGeneration: 0,
      spawnPending: false,
      currentPtyInstance: null,
      terminalStateSource: 'bootstrapping',
      terminalModelSequence: null,
      pendingTerminalModelOutput: [],
      terminalReplayRecovery: null,
      hasOutput: false,
      outputSequence: 0,
    }
  }

  function resetTerminal(entry: PoolEntry): void {
    entry.view.reset()
  }

  function disposeTerminalEntry(entry: PoolEntry): void {
    attachments.detach(entry)

    if (entry.transportSubscription) {
      try {
        entry.transportSubscription.dispose()
      } catch (error) {
        console.warn(
          terminalLogMessage(environment.loggerName, 'Failed to remove terminal transport subscription:'),
          error,
        )
      }
      entry.transportSubscription = null
    }

    for (const subscription of entry.viewSubscriptions.splice(0)) {
      try {
        subscription.dispose()
      } catch (error) {
        console.warn(
          terminalLogMessage(environment.loggerName, 'Failed to remove terminal view listener:'),
          error,
        )
      }
    }

    entry.view.dispose()
  }

  let recoverTerminalState: ((entry: PoolEntry) => Promise<void>) | null = null
  const reconnectReplay = createTerminalReconnectReplay({
    transport,
    environment,
    getEntries: () => pool.values(),
    hasEntries: () => pool.size > 0,
    notifyLifecycle: sessionLifecycle.notifyShellLifecycle,
    recoverEntry: entry => recoverTerminalState?.(entry) ?? Promise.resolve(),
  })
  const acquisition = createTerminalAcquisition({
    transport,
    environment,
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
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    let disposalError: unknown = null
    try {
      releaseAll()
    } catch (error) {
      disposalError = error
    }
    try {
      reconnectReplay.dispose()
    } catch (error) {
      disposalError ??= error
    }
    try {
      unsubscribeThemeMode()
    } catch (error) {
      disposalError ??= error
    }
    try {
      transport.dispose()
    } catch (error) {
      disposalError ??= error
    }
    if (disposalError) throw disposalError
  }

  function releaseAll(): void {
    let releaseError: unknown = null
    try {
      acquisition.releaseAll()
    } catch (error) {
      releaseError = error
    }
    try {
      sessionLifecycle.clearAll()
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

  function focusTerminal(terminalKey: string): void {
    attachments.focus(pool.get(terminalKey))
  }

  function hasTerminal(terminalKey: string): boolean {
    return pool.has(terminalKey)
  }

  function isPtyActive(terminalKey: string): boolean {
    return pool.get(terminalKey)?.ptyActive ?? false
  }

  async function restorePtyInstance(terminalKey: string, instanceId: number): Promise<void> {
    const entry = pool.get(terminalKey)
    const shouldRecoverState = entry !== undefined
      && (!entry.ptyActive || entry.currentPtyInstance !== instanceId)
    sessionLifecycle.restorePtyInstance(terminalKey, instanceId)
    if (!entry || !shouldRecoverState) return
    try {
      await acquisition.recoverTerminalState(entry)
      if (entry.attached) await attachments.recoverActiveTerminal(entry)
    } catch (error) {
      console.error(terminalLogMessage(environment.loggerName, 'Failed to resolve restored terminal authority:'), error)
    }
  }

  async function markShellPtyStarted(entry: PoolEntry, instanceId: number): Promise<void> {
    sessionLifecycle.markPtyStarted(entry, instanceId)
    try {
      await acquisition.recoverTerminalState(entry)
    } catch (error) {
      console.error(terminalLogMessage(environment.loggerName, 'Failed to resolve spawned terminal authority:'), error)
    }
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
    restorePtyInstance,
    markShellPtyStarted,
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
