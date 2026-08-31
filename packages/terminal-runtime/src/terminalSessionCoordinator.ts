import { isValidTerminalDimensions } from './terminalGeometry'
import { terminalLogMessage } from './terminalLogging'
import {
  createTerminalOutputObservation,
  recordTerminalOutput,
  synchronizeTerminalOutputObservation,
} from './terminalOutputObservation'
import { parsePtySessionKey } from './ptySessionKey'
import type { TerminalImageProtocol } from './terminalImages'
import type {
  ShellLifecycleState,
  TerminalPtySpawnLease,
  TerminalRuntimeEnvironment,
  TerminalSession,
  TerminalSessionDiagnostics,
  TerminalStateSource,
  TerminalViewAttachment,
} from './terminalRuntimeTypes'
import { createTerminalSessionHandle } from './terminalRuntimeTypes'
import type {
  TerminalGeometry,
  TerminalModelDisabledEvent,
  TerminalModelOutputEvent,
  TerminalReplay,
  TerminalSessionTransportSubscription,
  TerminalTransport,
} from './terminalTransport'
import type { TerminalView, TerminalViewDisposable, TerminalViewTheme } from './terminalView'

const MAX_PENDING_OUTPUTS = 256
const MAX_INITIAL_FIT_ANIMATION_FRAMES = 120
const MIN_VISIBLE_RECOVERY_RETRY_MS = 100
const MAX_VISIBLE_RECOVERY_RETRY_MS = 30_000

interface TerminalRenderRevision {
  attachmentGeneration: number
  visibilityGeneration: number
}

export interface TerminalSessionCoordinatorOptions {
  shellSessionKey: string
  view: TerminalView
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  notifyLifecycle(shellSessionKey: string): void
}

export interface TerminalSessionCoordinator {
  readonly session: TerminalSession
  start(): Promise<void>
  attach(host: HTMLDivElement): Promise<TerminalViewAttachment>
  beginPtySpawn(): TerminalPtySpawnLease | null
  applyPendingRestoredPtyInstance(instanceId: number): Promise<void>
  restorePtyInstance(instanceId: number): Promise<void>
  recoverFromAuthority(): Promise<void>
  recoverAfterReconnect(): Promise<void>
  getLifecycleState(): ShellLifecycleState
  isShellExited(): boolean
  resetPresentation(): Promise<void>
  focus(): void
  refresh(): void
  setTheme(theme: TerminalViewTheme): void
  diagnostics(): TerminalSessionDiagnostics
  capturePresentation(): ReturnType<TerminalView['capturePresentation']>
  drainPresentation(): ReturnType<TerminalView['drainPresentation']>
  dispose(): void
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function pushBounded<T>(queue: T[], value: T): void {
  if (queue.length === MAX_PENDING_OUTPUTS) queue.shift()
  queue.push(value)
}

export function createTerminalSessionCoordinator({
  shellSessionKey,
  view,
  transport,
  environment,
  notifyLifecycle,
}: TerminalSessionCoordinatorOptions): TerminalSessionCoordinator {
  const session = createTerminalSessionHandle(shellSessionKey)
  const terminalOutputObservation = createTerminalOutputObservation()
  const lifecycleListeners = new Set<(state: ShellLifecycleState) => void>()
  const viewSubscriptions: TerminalViewDisposable[] = []
  const pendingInitialFits = new Set<() => void>()
  const pendingInitialVisibilities = new Set<() => void>()

  let disposed = false
  let transportSubscription: TerminalSessionTransportSubscription | null = null
  let resizeObserver: ResizeObserver | null = null
  let visibilityObserver: IntersectionObserver | null = null
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null

  let ptyActive = false
  let needsClear = false
  let shellExited = false
  let attached = false
  let viewVisible = false
  let viewVisibilityGeneration = 0
  let viewNeedsRecovery = false
  let attachmentGeneration = 0
  let spawnGeneration = 0
  let activeSpawnGeneration: number | null = null
  let currentPtyInstance: number | null = null
  let terminalStateSource: TerminalStateSource = 'bootstrapping'
  let terminalModelSequence: number | null = null
  let outputSequence = 0
  let hasOutput = false
  let terminalReplayRecovery: Promise<void> | null = null
  const pendingTerminalModelOutput: TerminalModelOutputEvent[] = []

  function lifecycleState(): ShellLifecycleState {
    return { ptyActive, shellExited, currentPtyInstance, hasOutput }
  }

  function notify(): void {
    const state = lifecycleState()
    notifyLifecycle(shellSessionKey)
    for (const listener of lifecycleListeners) listener(state)
  }

  function setCurrentPtyInstance(instanceId: number | null): void {
    if (currentPtyInstance !== instanceId) {
      outputSequence = 0
      terminalModelSequence = null
      pendingTerminalModelOutput.length = 0
      synchronizeTerminalOutputObservation(terminalOutputObservation, instanceId)
    }
    currentPtyInstance = instanceId
  }

  function selectPtyInstance(instanceId: number): void {
    setCurrentPtyInstance(instanceId)
    activeSpawnGeneration = null
    ptyActive = true
    shellExited = false
    needsClear = false
    notify()
  }

  function markOutput(): void {
    ptyActive = true
    shellExited = false
    hasOutput = true
    notify()
  }

  function markExited(): void {
    ptyActive = false
    shellExited = true
    needsClear = true
    notify()
  }

  function attachAgentTerminalKeyHandler(): void {
    if (parsePtySessionKey(shellSessionKey).kind === 'indexed-shell') return

    view.setKeyEventHandler((event) => {
      const isShiftEnter = event.key === 'Enter' && event.shiftKey
      const shouldConsume = isShiftEnter && (event.type === 'keydown' || event.type === 'keypress')
      if (!shouldConsume) return true

      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && ptyActive) {
        transport.writeUserInput(shellSessionKey, '\n').catch(error => {
          console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
        })
      }
      return false
    })
  }

  function isCurrentVisibleAttachment(
    requestedAttachmentGeneration: number,
    requestedVisibilityGeneration: number,
  ): boolean {
    return attached
      && viewVisible
      && attachmentGeneration === requestedAttachmentGeneration
      && viewVisibilityGeneration === requestedVisibilityGeneration
  }

  function isCurrentRenderRevision(revision: TerminalRenderRevision | null): boolean {
    return revision !== null
      && isCurrentVisibleAttachment(revision.attachmentGeneration, revision.visibilityGeneration)
  }

  function writeTerminalModelOutput(event: TerminalModelOutputEvent): boolean {
    if (currentPtyInstance !== event.ptyInstanceId) return true
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
    markOutput()
    return true
  }

  function flushPendingOutput(): void {
    if (!attached || !viewVisible) {
      pendingTerminalModelOutput.length = 0
      viewNeedsRecovery = true
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
    if (replay.ptyInstanceId === null) {
      ptyActive = false
      shellExited = false
      needsClear = false
      outputSequence = 0
      setCurrentPtyInstance(null)
      terminalModelSequence = null
      pendingTerminalModelOutput.length = 0
      hasOutput = Boolean(replay.historicalData)
      terminalStateSource = 'ghostty-snapshot'
      notify()

      if (!isCurrentRenderRevision(renderRevision)) {
        viewNeedsRecovery = true
        return
      }
      await view.replaceSnapshot({
        data: replay.historicalData ?? '',
        ptyInstanceId: null,
        sequence: outputSequence,
      })
      viewNeedsRecovery = !isCurrentRenderRevision(renderRevision)
      return
    }

    const snapshot = replay.snapshot
    if (!snapshot || snapshot.ptyInstanceId !== replay.ptyInstanceId) {
      throw new Error('Ghostty-authoritative terminal state requires a current snapshot')
    }

    ptyActive = replay.isLive
    shellExited = !replay.isLive
    needsClear = false
    outputSequence = 0
    setCurrentPtyInstance(replay.ptyInstanceId)
    terminalModelSequence = snapshot.watermark
    synchronizeTerminalOutputObservation(
      terminalOutputObservation,
      replay.ptyInstanceId,
      snapshot.watermark,
    )
    hasOutput = snapshot.data.length > 0 || Boolean(snapshot.compatibilityData?.length)
    terminalStateSource = 'ghostty-snapshot'
    notify()

    if (!isCurrentRenderRevision(renderRevision)) {
      viewNeedsRecovery = true
      return
    }

    await view.replaceSnapshot({
      data: snapshot.data,
      compatibilityData: snapshot.compatibilityData,
      ptyInstanceId: replay.ptyInstanceId,
      sequence: outputSequence,
    })
    const currentRenderRevision = isCurrentRenderRevision(renderRevision)
    viewNeedsRecovery = !currentRenderRevision
    if (currentRenderRevision) flushPendingOutput()
  }

  async function recoverFromAuthority(): Promise<void> {
    if (disposed) return
    if (terminalReplayRecovery) return terminalReplayRecovery

    const renderRequested = attached && viewVisible
    const requestedAttachmentGeneration = attachmentGeneration
    const requestedVisibilityGeneration = viewVisibilityGeneration
    const requestedInstance = currentPtyInstance
    const previousStateSource = terminalStateSource
    terminalStateSource = 'bootstrapping'

    const recovery = transport.readReplay(shellSessionKey).then((replay) => {
      if (disposed) return
      const instanceChanged = currentPtyInstance !== requestedInstance
        || (requestedInstance !== null && replay.ptyInstanceId !== requestedInstance)
      if (instanceChanged) {
        terminalStateSource = previousStateSource
        flushPendingOutput()
        return
      }

      const sameViewState = attachmentGeneration === requestedAttachmentGeneration
        && viewVisibilityGeneration === requestedVisibilityGeneration
      const renderRevision = renderRequested && sameViewState
        ? {
            attachmentGeneration: requestedAttachmentGeneration,
            visibilityGeneration: requestedVisibilityGeneration,
          }
        : null
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
    if (!attached || !viewVisible) {
      if (currentPtyInstance === event.ptyInstanceId) {
        terminalModelSequence = Math.max(terminalModelSequence ?? 0, event.sequence)
        viewNeedsRecovery = true
        markOutput()
      }
      return
    }
    if (
      activeSpawnGeneration !== null
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

  function handleTerminalModelDisabled(event: TerminalModelDisabledEvent): void {
    if (currentPtyInstance !== event.ptyInstanceId) return
    ptyActive = false
    notify()
  }

  async function start(): Promise<void> {
    if (disposed) throw new Error('Cannot start a disposed Terminal Session')
    const subscription = await transport.subscribeSession(shellSessionKey, {
      onModelOutput: handleTerminalModelOutput,
      onModelDisabled: handleTerminalModelDisabled,
      onExit: event => {
        if (currentPtyInstance !== null && event.ptyInstanceId !== currentPtyInstance) return
        markExited()
      },
    })
    if (disposed) {
      subscription.dispose()
      return
    }
    transportSubscription = subscription

    await recoverFromAuthority()
    viewNeedsRecovery = true
    if (disposed) return

    attachAgentTerminalKeyHandler()
    viewSubscriptions.push(view.onUserInput((data) => {
      if (!ptyActive) return
      environment.performanceTrace?.mark('inputAcceptance', {
        terminalKey: shellSessionKey,
        ptyInstanceId: currentPtyInstance,
      })
      transport.writeUserInput(shellSessionKey, data).catch(error => {
        console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
      })
    }))
  }
  function syncPtySize(dimensions: TerminalGeometry | null = view.geometry): void {
    if (!ptyActive || !attached || !viewVisible) return
    if (!isValidTerminalDimensions(dimensions)) return
    transport.resize(shellSessionKey, dimensions)
      .catch(error => console.error(terminalLogMessage(environment.loggerName, 'resize failed:'), error))
  }

  function shouldStopInitialFit(
    requestedAttachmentGeneration: number,
    signal?: AbortSignal,
  ): boolean {
    return Boolean(signal?.aborted)
      || !attached
      || !viewVisible
      || attachmentGeneration !== requestedAttachmentGeneration
  }

  function waitForInitialFit(
    requestedAttachmentGeneration: number,
    signal?: AbortSignal,
  ): Promise<TerminalGeometry | null> {
    return new Promise((resolve) => {
      let frameId: number | null = null
      let frameCount = 0
      let settled = false

      const finish = (dimensions: TerminalGeometry | null = null) => {
        if (settled) return
        settled = true
        if (frameId !== null) cancelAnimationFrame(frameId)
        signal?.removeEventListener('abort', cancel)
        pendingInitialFits.delete(cancel)
        resolve(dimensions)
      }
      const cancel = () => finish()
      const scheduleNextFit = () => {
        if (shouldStopInitialFit(requestedAttachmentGeneration, signal)) {
          finish()
          return
        }
        if (frameCount >= MAX_INITIAL_FIT_ANIMATION_FRAMES) {
          console.warn(terminalLogMessage(
            environment.loggerName,
            `Initial fit stopped after ${MAX_INITIAL_FIT_ANIMATION_FRAMES} animation frames for "${shellSessionKey}"; terminal dimensions remained invalid.`,
          ))
          finish()
          return
        }

        frameId = requestAnimationFrame(() => {
          frameId = null
          if (shouldStopInitialFit(requestedAttachmentGeneration, signal)) {
            finish()
            return
          }
          frameCount += 1
          const dimensions = view.fit()
          if (isValidTerminalDimensions(dimensions)) {
            view.refresh()
            if (!isModalOpen()) view.focus()
            syncPtySize(dimensions)
            finish(dimensions)
            return
          }
          scheduleNextFit()
        })
      }

      pendingInitialFits.add(cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      scheduleNextFit()
    })
  }

  function cancelPendingInitialFits(): void {
    for (const cancel of [...pendingInitialFits]) cancel()
  }

  function cancelPendingInitialVisibilities(): void {
    for (const cancel of [...pendingInitialVisibilities]) cancel()
  }

  function pauseModelOutput(reason: string): void {
    void transportSubscription?.setModelOutputEnabled(false).catch(error => {
      console.warn(terminalLogMessage(environment.loggerName, reason), error)
    })
  }

  async function restoreVisibleAttachment(
    requestedAttachmentGeneration: number,
    requestedVisibilityGeneration: number,
  ): Promise<void> {
    const subscription = transportSubscription
    try {
      await subscription?.setModelOutputEnabled(true)
      if (!isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) {
        if (!attached || !viewVisible) await subscription?.setModelOutputEnabled(false)
        return
      }

      await recoverFromAuthority()
      if (isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)
        && viewNeedsRecovery) {
        await recoverFromAuthority()
      }
      if (!isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) {
        if (!attached || !viewVisible) await subscription?.setModelOutputEnabled(false)
        return
      }
      await waitForInitialFit(requestedAttachmentGeneration)
    } catch (error) {
      if (isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) {
        viewNeedsRecovery = true
      }
      pauseModelOutput('Failed to pause terminal output after visibility recovery failed:')
      throw error
    }
  }

  async function restoreVisibleAttachmentWithRetry(
    requestedAttachmentGeneration: number,
    requestedVisibilityGeneration: number,
  ): Promise<void> {
    let retryDelay = MIN_VISIBLE_RECOVERY_RETRY_MS
    while (isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) {
      try {
        await restoreVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)
        return
      } catch (error) {
        if (!isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) return
        console.warn(
          terminalLogMessage(environment.loggerName, `Visible terminal recovery failed; retrying in ${retryDelay}ms:`),
          error,
        )
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        retryDelay = Math.min(retryDelay * 2, MAX_VISIBLE_RECOVERY_RETRY_MS)
      }
    }
  }

  function setViewVisibility(
    requestedAttachmentGeneration: number,
    visible: boolean,
    retryOnFailure = false,
  ): Promise<void> {
    if (!attached || attachmentGeneration !== requestedAttachmentGeneration) return Promise.resolve()
    if (viewVisible === visible) return Promise.resolve()

    viewVisible = visible
    viewVisibilityGeneration += 1
    const requestedVisibilityGeneration = viewVisibilityGeneration
    view.setVisible(visible)

    if (!visible) {
      cancelPendingInitialFits()
      viewNeedsRecovery = true
      pauseModelOutput('Failed to pause hidden terminal output:')
      return Promise.resolve()
    }

    return retryOnFailure
      ? restoreVisibleAttachmentWithRetry(requestedAttachmentGeneration, requestedVisibilityGeneration)
      : restoreVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)
  }

  function createAttachment(generation: number): TerminalViewAttachment {
    return Object.freeze({
      generation,
      refit: (signal?: AbortSignal) => {
        if (!attached || !viewVisible || attachmentGeneration !== generation) return Promise.resolve(null)
        return waitForInitialFit(generation, signal)
      },
      detach: () => detach(generation),
    })
  }

  async function attach(host: HTMLDivElement): Promise<TerminalViewAttachment> {
    if (disposed) throw new Error('Cannot attach a disposed Terminal Session')
    if (attached && view.isMountedIn(host)) return createAttachment(attachmentGeneration)
    if (attached) detach()

    environment.performanceTrace?.mark('terminalAttachment', {
      terminalKey: shellSessionKey,
    })
    attachmentGeneration += 1
    viewVisibilityGeneration += 1
    const generation = attachmentGeneration
    viewVisible = false
    view.setVisible(false)
    view.mount(host)
    attached = true

    resizeObserver = new ResizeObserver((entries) => {
      if (!attached || !viewVisible || attachmentGeneration !== generation) return
      const { width, height } = entries[0].contentRect
      if (width === 0 || height === 0) return
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        if (!attached || !viewVisible || attachmentGeneration !== generation) return
        const dimensions = view.fit()
        syncPtySize(dimensions)
      }, 100)
    })
    resizeObserver.observe(view.resizeTarget)

    let initialVisibilitySettled = false
    let cancelInitialVisibility!: () => void
    let settleInitialVisibility!: (error?: unknown) => void
    const initialVisibility = new Promise<void>((resolve, reject) => {
      settleInitialVisibility = error => {
        if (initialVisibilitySettled) return
        initialVisibilitySettled = true
        pendingInitialVisibilities.delete(cancelInitialVisibility)
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    cancelInitialVisibility = () => settleInitialVisibility()
    pendingInitialVisibilities.add(cancelInitialVisibility)

    let initialVisibilityPending = true
    visibilityObserver = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      const isInitialVisibility = initialVisibilityPending
      initialVisibilityPending = false
      const transition = setViewVisibility(generation, last.isIntersecting, !isInitialVisibility)
      if (isInitialVisibility) {
        void transition.then(() => settleInitialVisibility(), settleInitialVisibility)
        return
      }
      void transition.catch(error => {
        console.warn(terminalLogMessage(environment.loggerName, 'Failed to restore visible terminal state:'), error)
      })
    }, { threshold: 0 })
    visibilityObserver.observe(host)

    try {
      await initialVisibility
    } catch (error) {
      detach(generation)
      throw error
    }
    return createAttachment(generation)
  }

  function detach(requestedAttachmentGeneration = attachmentGeneration): void {
    if (!attached || requestedAttachmentGeneration !== attachmentGeneration) return
    cancelPendingInitialFits()
    cancelPendingInitialVisibilities()
    if (resizeTimeout) clearTimeout(resizeTimeout)
    resizeTimeout = null
    resizeObserver?.disconnect()
    resizeObserver = null
    visibilityObserver?.disconnect()
    visibilityObserver = null
    viewVisible = false
    viewVisibilityGeneration += 1
    view.setVisible(false)
    pauseModelOutput('Failed to pause detached terminal output:')
    viewNeedsRecovery = true
    attached = false
    view.unmount()
  }

  function beginPtySpawn(): TerminalPtySpawnLease | null {
    if (disposed || ptyActive || activeSpawnGeneration !== null) return null
    const geometry = view.geometry
    if (!isValidTerminalDimensions(geometry)) return null

    spawnGeneration += 1
    const generation = spawnGeneration
    activeSpawnGeneration = generation
    hasOutput = false
    notify()

    const imageProtocol: TerminalImageProtocol | null = view.imageProtocol
    return Object.freeze({
      generation,
      geometry: { ...geometry },
      imageProtocol,
      started: async (instanceId: number) => {
        if (activeSpawnGeneration !== generation || disposed) return
        selectPtyInstance(instanceId)
        await recoverFromAuthority()
      },
      cancel: () => {
        if (activeSpawnGeneration !== generation) return
        activeSpawnGeneration = null
        notify()
      },
    })
  }

  async function restorePtyInstance(instanceId: number): Promise<void> {
    const shouldRecover = !ptyActive || currentPtyInstance !== instanceId
    selectPtyInstance(instanceId)
    if (!shouldRecover) return
    await recoverFromAuthority()
    if (attached && viewVisible) await waitForInitialFit(attachmentGeneration)
  }

  async function applyPendingRestoredPtyInstance(instanceId: number): Promise<void> {
    if (ptyActive && currentPtyInstance !== null) return
    await restorePtyInstance(instanceId)
  }

  async function recoverAfterReconnect(): Promise<void> {
    if (needsClear) return
    await recoverFromAuthority()
    notify()
    if (attached) view.refresh()
  }

  async function resetPresentation(): Promise<void> {
    await view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 })
  }

  function focus(): void {
    if (attached && viewVisible && !isModalOpen()) view.focus()
  }

  function refresh(): void {
    if (attached) view.refresh()
  }

  function setTheme(theme: TerminalViewTheme): void {
    view.setTheme(theme)
  }

  function diagnostics(): TerminalSessionDiagnostics {
    return Object.freeze({
      shellSessionKey,
      lifecycle: Object.freeze({
        ...lifecycleState(),
        attached,
        spawnPending: activeSpawnGeneration !== null,
        stateSource: terminalStateSource,
      }),
      output: Object.freeze({
        ...terminalOutputObservation,
        modelSequence: terminalModelSequence,
      }),
      view: Object.freeze({
        attached,
        visible: viewVisible,
        needsRecovery: viewNeedsRecovery,
        attachmentGeneration,
        authorityReadPending: terminalReplayRecovery !== null,
      }),
      modelOutputSubscription: transportSubscription?.snapshot?.() ?? null,
      geometry: Object.freeze({ ...view.geometry }),
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    detach()
    transportSubscription?.dispose()
    transportSubscription = null
    for (const subscription of viewSubscriptions.splice(0)) subscription.dispose()
    lifecycleListeners.clear()
    view.dispose()
  }

  return {
    session,
    start,
    attach,
    beginPtySpawn,
    applyPendingRestoredPtyInstance,
    restorePtyInstance,
    recoverFromAuthority,
    recoverAfterReconnect,
    getLifecycleState: lifecycleState,
    isShellExited: () => shellExited,
    resetPresentation,
    focus,
    refresh,
    setTheme,
    diagnostics,
    capturePresentation: () => view.capturePresentation(),
    drainPresentation: () => view.drainPresentation(),
    dispose,
  }
}
