import { isValidTerminalDimensions } from './terminalGeometry'
import { terminalLogMessage } from './terminalLogging'
import type { TerminalRuntimeEnvironment, TerminalViewAttachment } from './terminalRuntimeTypes'
import type { TerminalGeometry } from './terminalTransport'
import type { TerminalView } from './terminalView'

const MAX_INITIAL_FIT_ANIMATION_FRAMES = 120
const MIN_VISIBLE_RECOVERY_RETRY_MS = 100
const MAX_VISIBLE_RECOVERY_RETRY_MS = 30_000

export interface TerminalRenderRevision {
  attachmentGeneration: number
  visibilityGeneration: number
}

export interface TerminalViewAttachmentLifecycle {
  restoreVisibleAttachment(
    attachmentGeneration: number,
    visibilityGeneration: number,
  ): Promise<void>
  pauseModelOutput(reason: string): void
  syncPtySize(dimensions: TerminalGeometry | null): void
}

interface TerminalViewAttachmentCoordinatorOptions {
  shellSessionKey: string
  view: TerminalView
  environment: TerminalRuntimeEnvironment
}

export interface TerminalViewAttachmentCoordinator {
  configureLifecycle(lifecycle: TerminalViewAttachmentLifecycle): void
  attach(host: HTMLDivElement): Promise<TerminalViewAttachment>
  detach(requestedAttachmentGeneration?: number): void
  isAttached(): boolean
  isActive(): boolean
  isCurrentVisibleAttachment(
    attachmentGeneration: number,
    visibilityGeneration: number,
  ): boolean
  currentRenderRevision(): TerminalRenderRevision | null
  isCurrentRenderRevision(revision: TerminalRenderRevision | null): boolean
  needsRecovery(): boolean
  markNeedsRecovery(): void
  finishSnapshotRender(revision: TerminalRenderRevision | null): boolean
  refitCurrent(): Promise<TerminalGeometry | null>
  focus(): void
  refresh(): void
  diagnostics(): {
    attached: boolean
    visible: boolean
    needsRecovery: boolean
    attachmentGeneration: number
  }
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function createTerminalViewAttachmentCoordinator({
  shellSessionKey,
  view,
  environment,
}: TerminalViewAttachmentCoordinatorOptions): TerminalViewAttachmentCoordinator {
  const pendingInitialFits = new Set<() => void>()
  const pendingInitialVisibilities = new Set<() => void>()

  let lifecycle: TerminalViewAttachmentLifecycle | null = null
  let resizeObserver: ResizeObserver | null = null
  let visibilityObserver: IntersectionObserver | null = null
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null
  let attached = false
  let viewVisible = false
  let viewVisibilityGeneration = 0
  let viewNeedsRecovery = false
  let attachmentGeneration = 0

  function getLifecycle(): TerminalViewAttachmentLifecycle {
    if (!lifecycle) throw new Error('Terminal view attachment lifecycle is not configured')
    return lifecycle
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

  function currentRenderRevision(): TerminalRenderRevision | null {
    if (!attached || !viewVisible) return null
    return {
      attachmentGeneration,
      visibilityGeneration: viewVisibilityGeneration,
    }
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
            getLifecycle().syncPtySize(dimensions)
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

  async function restoreVisibleAttachment(
    requestedAttachmentGeneration: number,
    requestedVisibilityGeneration: number,
  ): Promise<void> {
    try {
      await getLifecycle().restoreVisibleAttachment(
        requestedAttachmentGeneration,
        requestedVisibilityGeneration,
      )
    } catch (error) {
      if (isCurrentVisibleAttachment(requestedAttachmentGeneration, requestedVisibilityGeneration)) {
        viewNeedsRecovery = true
      }
      getLifecycle().pauseModelOutput(
        'Failed to pause terminal output after visibility recovery failed:',
      )
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
      getLifecycle().pauseModelOutput('Failed to pause hidden terminal output:')
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
        getLifecycle().syncPtySize(view.fit())
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
    getLifecycle().pauseModelOutput('Failed to pause detached terminal output:')
    viewNeedsRecovery = true
    attached = false
    view.unmount()
  }

  function finishSnapshotRender(revision: TerminalRenderRevision | null): boolean {
    const current = isCurrentRenderRevision(revision)
    viewNeedsRecovery = !current
    return current
  }

  return {
    configureLifecycle: nextLifecycle => {
      if (lifecycle) throw new Error('Terminal view attachment lifecycle is already configured')
      lifecycle = nextLifecycle
    },
    attach,
    detach,
    isAttached: () => attached,
    isActive: () => attached && viewVisible,
    isCurrentVisibleAttachment,
    currentRenderRevision,
    isCurrentRenderRevision,
    needsRecovery: () => viewNeedsRecovery,
    markNeedsRecovery: () => { viewNeedsRecovery = true },
    finishSnapshotRender,
    refitCurrent: () => {
      if (!attached || !viewVisible) return Promise.resolve(null)
      return waitForInitialFit(attachmentGeneration)
    },
    focus: () => {
      if (attached && viewVisible && !isModalOpen()) view.focus()
    },
    refresh: () => {
      if (attached) view.refresh()
    },
    diagnostics: () => ({
      attached,
      visible: viewVisible,
      needsRecovery: viewNeedsRecovery,
      attachmentGeneration,
    }),
  }
}
