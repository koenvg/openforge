import { derived, get, readable } from 'svelte/store'
import { createTerminalAcquisition } from './terminalAcquisition'
import { isValidTerminalDimensions } from './terminalGeometry'
import { preloadTerminalFonts, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, type TerminalFontReadiness } from './terminalOptions'
import type { TerminalPerformanceMarkContext, TerminalPerformancePhase } from './terminalPerformanceTrace'
import { createTerminalReconnectReplay } from './terminalReconnectReplay'
import {
  createTerminalSessionCoordinator,
  type TerminalSessionCoordinator,
} from './terminalSessionCoordinator'
import { createTerminalSessionLifecycle } from './terminalSessionLifecycle'
import type { TerminalTransport } from './terminalTransport'
import type {
  TerminalRuntimeDiagnostics,
  TerminalRuntimeEnvironment,
  TerminalSession,
  TerminalSessionDiagnostics,
} from './terminalRuntimeTypes'
import { applyTerminalFont } from './terminalFontPropagation'
import { applyTerminalFontSize } from './terminalFontSizePropagation'
import { applyTerminalTheme } from './terminalThemePropagation'
import type { TerminalViewFactory } from './terminalView'
import { createXtermTerminalView } from './xtermTerminalView'
import { getTerminalThemeSnapshot, themePresentation as defaultThemePresentation } from './theme'

export type { TerminalOutputObservation } from './terminalOutputObservation'
export type { TerminalImageProtocol } from './terminalImages'
export type {
  TerminalExitEvent,
  TerminalGeometry,
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalSnapshot,
  TerminalSessionTransportHandlers,
  TerminalSessionTransportSubscription,
  TerminalTransport,
  TerminalTransportDisposable,
} from './terminalTransport'
export type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalPtySpawnLease,
  TerminalRuntimeDiagnostics,
  TerminalRuntimeEnvironment,
  TerminalRuntimeUnlistenFn,
  TerminalSession,
  TerminalSessionConfiguration,
  TerminalSessionDiagnostics,
  TerminalStateSource,
  TerminalTab,
  TerminalViewAttachment,
} from './terminalRuntimeTypes'
export type {
  TerminalView,
  TerminalViewData,
  TerminalViewDisposable,
  TerminalViewFactory,
  TerminalViewFactoryOptions,
  TerminalViewGeometry,
  TerminalViewLiveOutput,
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
  beforeSessionStart?(
    session: TerminalSession,
    getDiagnostics: () => TerminalSessionDiagnostics,
  ): Promise<void> | undefined
}

export function createTerminalRuntime({
  transport,
  environment,
  createTerminalView = createXtermTerminalView,
  beforeSessionStart,
}: TerminalRuntimeOptions) {
  const activeThemePresentation = environment.themePresentation
    ?? (environment.themeMode ? derived(environment.themeMode, getTerminalThemeSnapshot) : defaultThemePresentation)
  const activeFontFamily = environment.fontFamily ?? readable(TERMINAL_FONT_FAMILY)
  const activeFontSize = environment.fontSize ?? readable(TERMINAL_FONT_SIZE)
  const coordinators = new Map<string, TerminalSessionCoordinator>()
  const coordinatorsBySession = new WeakMap<TerminalSession, TerminalSessionCoordinator>()
  const sessionLifecycle = createTerminalSessionLifecycle(key => coordinators.get(key))

  function createCoordinator(
    shellSessionKey: string,
    fontReadiness: TerminalFontReadiness,
  ): TerminalSessionCoordinator {
    const configuration = environment.sampleSessionConfiguration?.(shellSessionKey) ?? {
      renderer: 'xterm' as const,
      enableImages: environment.enableImages,
    }
    const themeSnapshot = get(activeThemePresentation)
    const coordinator = createTerminalSessionCoordinator({
      shellSessionKey,
      view: createTerminalView({
        terminalKey: shellSessionKey,
        appearance: themeSnapshot.appearance,
        themeMode: themeSnapshot.appearance,
        theme: themeSnapshot.terminalTheme,
        fontFamily: get(activeFontFamily),
        fontSize: get(activeFontSize),
        openLink: url => environment.openLink(url),
        enableImages: configuration.enableImages,
        loggerName: environment.loggerName,
        fontReadiness,
        performanceTrace: environment.performanceTrace,
      }),
      transport,
      environment,
      notifyLifecycle: sessionLifecycle.notifyShellLifecycle,
    })
    coordinatorsBySession.set(coordinator.session, coordinator)
    return coordinator
  }

  function coordinatorFor(session: TerminalSession): TerminalSessionCoordinator {
    const coordinator = coordinatorsBySession.get(session)
    if (!coordinator || coordinators.get(session.shellSessionKey) !== coordinator) {
      throw new Error(`Terminal Session "${session.shellSessionKey}" is not acquired by this runtime`)
    }
    return coordinator
  }

  function coordinatorForKey(shellSessionKey: string): TerminalSessionCoordinator {
    const coordinator = coordinators.get(shellSessionKey)
    if (!coordinator) throw new Error(`Unknown Terminal Session: ${shellSessionKey}`)
    return coordinator
  }

  const reconnectReplay = createTerminalReconnectReplay({
    transport,
    environment,
    getCoordinators: () => coordinators.values(),
    hasCoordinators: () => coordinators.size > 0,
  })
  const acquisition = createTerminalAcquisition({
    coordinators,
    createCoordinator,
    beforeSessionStart,
    preloadEntry: preloadTerminalFonts,
    lifecycle: sessionLifecycle,
    reconnectReplay,
  })

  const unsubscribeThemePresentation = activeThemePresentation.subscribe(snapshot => {
    applyTerminalTheme(coordinators.values(), snapshot)
  })
  const unsubscribeFontFamily = activeFontFamily.subscribe(fontFamily => {
    applyTerminalFont(coordinators.values(), fontFamily)
  })
  const unsubscribeFontSize = activeFontSize.subscribe(fontSize => {
    applyTerminalFontSize(coordinators.values(), fontSize)
  })
  let disposed = false

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
      unsubscribeThemePresentation()
    } catch (error) {
      disposalError ??= error
    }
    try {
      unsubscribeFontFamily()
    } catch (error) {
      disposalError ??= error
    }
    try {
      unsubscribeFontSize()
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

  function markPerformancePhase(
    phase: TerminalPerformancePhase,
    context: TerminalPerformanceMarkContext,
  ): void {
    environment.performanceTrace?.mark(phase, context)
  }

  const diagnostics: TerminalRuntimeDiagnostics = Object.freeze({
    list: () => [...coordinators.keys()].sort(),
    observe: (shellSessionKey: string) => coordinatorForKey(shellSessionKey).diagnostics(),
    capturePresentation: (shellSessionKey: string) => coordinatorForKey(shellSessionKey).capturePresentation(),
    drainPresentation: (shellSessionKey: string) => coordinatorForKey(shellSessionKey).drainPresentation(),
  })

  return {
    isValidTerminalDimensions,
    acquire: acquisition.acquire,
    attach: (session: TerminalSession, host: HTMLDivElement) => coordinatorFor(session).attach(host),
    beginPtySpawn: (session: TerminalSession) => coordinatorFor(session).beginPtySpawn(),
    markPerformancePhase,
    release: acquisition.release,
    resetPresentation: (session: TerminalSession) => coordinatorFor(session).resetPresentation(),
    restorePtyInstance: sessionLifecycle.restorePtyInstance,
    subscribeShellLifecycle: sessionLifecycle.subscribeShellLifecycle,
    isShellExited: sessionLifecycle.isShellExited,
    getShellLifecycleState: sessionLifecycle.getShellLifecycleState,
    getTaskTerminalTabsSession: sessionLifecycle.getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession: sessionLifecycle.updateTaskTerminalTabsSession,
    clearTaskTerminalTabsSession: sessionLifecycle.clearTaskTerminalTabsSession,
    releaseAll,
    dispose,
    releaseAllForTask: acquisition.releaseAllForTask,
    focusTerminal: (shellSessionKey: string) => coordinators.get(shellSessionKey)?.focus(),
    hasTerminal: (shellSessionKey: string) => coordinators.has(shellSessionKey),
    isPtyActive: (shellSessionKey: string) => (
      coordinators.get(shellSessionKey)?.getLifecycleState().ptyActive ?? false
    ),
    replayPtyBuffersForActiveTerminals: reconnectReplay.replayActiveTerminals,
    diagnostics,
  }
}

export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>
