import { get } from 'svelte/store'
import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  type TerminalAuthorityContract,
} from './terminalAuthority'
import { createTerminalAcquisition } from './terminalAcquisition'
import { createTerminalAttachmentController, isValidTerminalDimensions } from './terminalAttachment'
import type { TerminalImageProtocol } from './terminalImages'
import { terminalLogMessage } from './terminalLogging'
import { preloadTerminalFonts, type TerminalFontReadiness } from './terminalOptions'
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

export {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  type TerminalAuthorityBinding,
  type TerminalAuthorityContract,
  type TerminalQueryResponseWrite,
  type XtermAuthoritativeTerminalContract,
} from './terminalAuthority'
export { APP_EVENTS_RECONNECTED_EVENT } from './terminalReconnectReplay'
export type { TerminalImageProtocol } from './terminalImages'
export {
  ptyExitEventName,
  ptyOutputEventName,
} from './terminalRuntimeTypes'
export type {
  AppEventsReconnectedPayload,
  PoolEntry,
  PtyBufferState,
  PtyExitEventPayload,
  PtyOutputEventPayload,
  TerminalStateSource,
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
  TerminalViewPresentationCell,
  TerminalViewPresentationEvidence,
  TerminalViewPresentationLine,
  TerminalViewPresentationSnapshot,
  TerminalViewRendererFailure,
  TerminalViewTheme,
} from './terminalView'

export interface TerminalRuntimeOptions {
  authority?: TerminalAuthorityContract
  createTerminalView?: TerminalViewFactory
}

export function createTerminalRuntime(
  host: TerminalRuntimeHost,
  options: TerminalRuntimeOptions = {},
) {
  const authority = options.authority ?? XTERM_AUTHORITATIVE_TERMINAL_CONTRACT
  const activeThemeMode = host.themeMode ?? defaultThemeMode
  const createView = options.createTerminalView ?? createXtermTerminalView
  const pool = new Map<string, PoolEntry>()
  const attachments = createTerminalAttachmentController(host)
  const sessionLifecycle = createTerminalSessionLifecycle(key => pool.get(key), authority)

  function createEntry(terminalKey: string, fontReadiness: TerminalFontReadiness): PoolEntry {
    return {
      shellSessionKey: terminalKey,
      view: createView({
        terminalKey,
        themeMode: get(activeThemeMode),
        openLink: url => host.openLink(terminalKey, url),
        enableImages: host.enableImages,
        loggerName: host.loggerName,
        fontReadiness,
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
      authority: null,
      terminalStateSource: 'bootstrapping',
      pendingPtyOutput: [],
      terminalReplayRecovery: null,
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
    authority,
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

  function restorePtyInstance(terminalKey: string, instanceId: number): void {
    const entry = pool.get(terminalKey)
    const shouldRecoverAttachment = entry?.attached === true
      && (!entry.ptyActive || entry.currentPtyInstance !== instanceId)
    sessionLifecycle.restorePtyInstance(terminalKey, instanceId)
    if (entry && shouldRecoverAttachment) void attachments.recoverActiveTerminal(entry)
  }

  function markShellPtyStarted(entry: PoolEntry, instanceId: number): void {
    sessionLifecycle.markPtyStarted(entry, instanceId)
    acquisition.flushPendingOutput(entry)
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
