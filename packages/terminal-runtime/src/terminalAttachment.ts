import { terminalLogMessage } from './terminalLogging'
import type { TerminalTransport } from './terminalTransport'
import type { PoolEntry, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'

export interface TerminalViewAttachment {
  readonly generation: number
  detach(): void
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

const MIN_PTY_DIMENSION = 1
const MAX_PTY_DIMENSION = 0xFFFF
const MAX_INITIAL_FIT_ANIMATION_FRAMES = 120
const MIN_VISIBLE_RECOVERY_RETRY_MS = 100
const MAX_VISIBLE_RECOVERY_RETRY_MS = 30_000

function isValidPtyDimension(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_PTY_DIMENSION
    && value <= MAX_PTY_DIMENSION
}

export function isValidTerminalDimensions(
  dimensions: { cols: unknown; rows: unknown } | null | undefined,
): dimensions is { cols: number; rows: number } {
  return Boolean(dimensions)
    && isValidPtyDimension(dimensions?.cols)
    && isValidPtyDimension(dimensions?.rows)
}

export function safeFit(entry: PoolEntry): boolean {
  return isValidTerminalDimensions(entry.view.fit())
}

function refreshAndFocus(entry: PoolEntry): void {
  entry.view.refresh()
  if (!isModalOpen()) entry.view.focus()
}

export function createTerminalAttachmentController(
  transport: TerminalTransport,
  environment: TerminalRuntimeEnvironment,
  recoverEntry: (entry: PoolEntry) => Promise<void>,
) {
  const pendingInitialFits = new WeakMap<PoolEntry, Set<() => void>>()
  const pendingInitialVisibilities = new WeakMap<PoolEntry, Set<() => void>>()

  function syncPtySize(entry: PoolEntry): void {
    if (!entry.ptyActive) return
    const dimensions = entry.view.geometry
    if (!isValidTerminalDimensions(dimensions)) return
    transport.resize(entry.shellSessionKey, dimensions)
      .catch(error => console.error(terminalLogMessage(environment.loggerName, 'resize failed:'), error))
  }

  function shouldStopInitialFit(
    entry: PoolEntry,
    attachmentGeneration: number,
    signal?: AbortSignal,
  ): boolean {
    return Boolean(signal?.aborted)
      || !entry.attached
      || !entry.viewVisible
      || entry.attachmentGeneration !== attachmentGeneration
  }

  function waitForInitialFit(
    entry: PoolEntry,
    attachmentGeneration: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      let frameId: number | null = null
      let frameCount = 0
      let settled = false
      const pendingForEntry = pendingInitialFits.get(entry) ?? new Set<() => void>()
      pendingInitialFits.set(entry, pendingForEntry)

      const finish = () => {
        if (settled) return
        settled = true
        if (frameId !== null) cancelAnimationFrame(frameId)
        signal?.removeEventListener('abort', finish)
        pendingForEntry.delete(finish)
        if (pendingForEntry.size === 0) pendingInitialFits.delete(entry)
        resolve()
      }

      const scheduleNextFit = () => {
        if (shouldStopInitialFit(entry, attachmentGeneration, signal)) {
          finish()
          return
        }
        if (frameCount >= MAX_INITIAL_FIT_ANIMATION_FRAMES) {
          console.warn(terminalLogMessage(
            environment.loggerName,
            `Initial fit stopped after ${MAX_INITIAL_FIT_ANIMATION_FRAMES} animation frames for "${entry.shellSessionKey}"; terminal dimensions remained invalid.`,
          ))
          finish()
          return
        }

        frameId = requestAnimationFrame(() => {
          frameId = null
          if (shouldStopInitialFit(entry, attachmentGeneration, signal)) {
            finish()
            return
          }

          frameCount += 1
          if (safeFit(entry)) {
            refreshAndFocus(entry)
            syncPtySize(entry)
            finish()
            return
          }
          scheduleNextFit()
        })
      }

      pendingForEntry.add(finish)
      signal?.addEventListener('abort', finish, { once: true })
      scheduleNextFit()
    })
  }

  function cancelPendingInitialFits(entry: PoolEntry): void {
    const pendingForEntry = pendingInitialFits.get(entry)
    if (!pendingForEntry) return
    for (const cancel of [...pendingForEntry]) cancel()
  }

  function cancelPendingInitialVisibilities(entry: PoolEntry): void {
    const pendingForEntry = pendingInitialVisibilities.get(entry)
    if (!pendingForEntry) return
    for (const cancel of [...pendingForEntry]) cancel()
  }

  function createAttachment(entry: PoolEntry, generation: number): TerminalViewAttachment {
    return {
      generation,
      detach: () => detach(entry, generation),
    }
  }

  function isCurrentVisibleAttachment(
    entry: PoolEntry,
    attachmentGeneration: number,
    visibilityGeneration: number,
  ): boolean {
    return entry.attached
      && entry.viewVisible
      && entry.attachmentGeneration === attachmentGeneration
      && entry.viewVisibilityGeneration === visibilityGeneration
  }

  function pauseModelOutput(entry: PoolEntry, reason: string): void {
    void entry.transportSubscription?.setModelOutputEnabled(false).catch(error => {
      console.warn(terminalLogMessage(environment.loggerName, reason), error)
    })
  }

  async function restoreVisibleAttachment(
    entry: PoolEntry,
    attachmentGeneration: number,
    visibilityGeneration: number,
  ): Promise<void> {
    const subscription = entry.transportSubscription
    try {
      await subscription?.setModelOutputEnabled(true)
      if (!isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)) {
        if (!entry.attached || !entry.viewVisible) await subscription?.setModelOutputEnabled(false)
        return
      }

      await recoverEntry(entry)
      if (isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)
        && entry.viewNeedsRecovery) {
        await recoverEntry(entry)
      }
      if (!isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)) {
        if (!entry.attached || !entry.viewVisible) await subscription?.setModelOutputEnabled(false)
        return
      }

      await waitForInitialFit(entry, attachmentGeneration)
    } catch (error) {
      if (isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)) {
        entry.viewNeedsRecovery = true
      }
      pauseModelOutput(entry, 'Failed to pause terminal output after visibility recovery failed:')
      throw error
    }
  }

  async function restoreVisibleAttachmentWithRetry(
    entry: PoolEntry,
    attachmentGeneration: number,
    visibilityGeneration: number,
  ): Promise<void> {
    let retryDelay = MIN_VISIBLE_RECOVERY_RETRY_MS
    while (isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)) {
      try {
        await restoreVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)
        return
      } catch (error) {
        if (!isCurrentVisibleAttachment(entry, attachmentGeneration, visibilityGeneration)) return
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
    entry: PoolEntry,
    attachmentGeneration: number,
    visible: boolean,
    retryOnFailure = false,
  ): Promise<void> {
    if (!entry.attached || entry.attachmentGeneration !== attachmentGeneration) return Promise.resolve()
    if (entry.viewVisible === visible) return Promise.resolve()

    entry.viewVisible = visible
    entry.viewVisibilityGeneration += 1
    const visibilityGeneration = entry.viewVisibilityGeneration
    entry.view.setVisible(visible)

    if (!visible) {
      cancelPendingInitialFits(entry)
      entry.viewNeedsRecovery = true
      pauseModelOutput(entry, 'Failed to pause hidden terminal output:')
      return Promise.resolve()
    }

    const restore = retryOnFailure ? restoreVisibleAttachmentWithRetry : restoreVisibleAttachment
    return restore(entry, attachmentGeneration, visibilityGeneration)
  }

  async function attach(
    entry: PoolEntry,
    wrapperEl: HTMLDivElement,
  ): Promise<TerminalViewAttachment> {
    if (entry.attached && entry.view.isMountedIn(wrapperEl)) {
      return createAttachment(entry, entry.attachmentGeneration)
    }
    if (entry.attached) detach(entry)

    environment.performanceTrace?.mark('terminalAttachment', {
      terminalKey: entry.shellSessionKey,
    })
    entry.attachmentGeneration += 1
    entry.viewVisibilityGeneration += 1
    const generation = entry.attachmentGeneration
    entry.viewVisible = false
    entry.view.setVisible(false)
    entry.view.mount(wrapperEl)
    entry.attached = true

    if (!entry.resizeObserver) {
      entry.resizeObserver = new ResizeObserver((entries) => {
        if (!entry.viewVisible) return
        const { width, height } = entries[0].contentRect
        if (width === 0 || height === 0) return
        if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
        entry.resizeTimeout = setTimeout(() => {
          entry.resizeTimeout = null
          if (!entry.viewVisible) return
          safeFit(entry)
          syncPtySize(entry)
        }, 100)
      })
    }
    entry.resizeObserver.disconnect()
    entry.resizeObserver.observe(entry.view.resizeTarget)

    const pendingVisibilities = pendingInitialVisibilities.get(entry) ?? new Set<() => void>()
    pendingInitialVisibilities.set(entry, pendingVisibilities)
    let initialVisibilitySettled = false
    let cancelInitialVisibility!: () => void
    let settleInitialVisibility!: (error?: unknown) => void
    const initialVisibility = new Promise<void>((resolve, reject) => {
      settleInitialVisibility = error => {
        if (initialVisibilitySettled) return
        initialVisibilitySettled = true
        pendingVisibilities.delete(cancelInitialVisibility)
        if (pendingVisibilities.size === 0) pendingInitialVisibilities.delete(entry)
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    cancelInitialVisibility = () => settleInitialVisibility()
    pendingVisibilities.add(cancelInitialVisibility)
    let initialVisibilityPending = true
    entry.visibilityObserver = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      const isInitialVisibility = initialVisibilityPending
      initialVisibilityPending = false
      const transition = setViewVisibility(entry, generation, last.isIntersecting, !isInitialVisibility)
      if (isInitialVisibility) {
        void transition.then(() => settleInitialVisibility(), settleInitialVisibility)
        return
      }
      void transition.catch(error => {
        console.warn(terminalLogMessage(environment.loggerName, 'Failed to restore visible terminal state:'), error)
      })
    }, { threshold: 0 })
    entry.visibilityObserver.observe(wrapperEl)

    try {
      await initialVisibility
    } catch (error) {
      detach(entry, generation)
      throw error
    }
    return createAttachment(entry, generation)
  }

  async function recoverActiveTerminal(entry: PoolEntry, signal?: AbortSignal): Promise<void> {
    if (!entry.attached || !entry.viewVisible) return
    await waitForInitialFit(entry, entry.attachmentGeneration, signal)
  }

  function detach(
    entry: PoolEntry,
    attachmentGeneration = entry.attachmentGeneration,
  ): void {
    if (!entry.attached || attachmentGeneration !== entry.attachmentGeneration) return
    cancelPendingInitialFits(entry)
    cancelPendingInitialVisibilities(entry)

    if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
    entry.resizeTimeout = null
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = null
    entry.visibilityObserver?.disconnect()
    entry.visibilityObserver = null
    entry.viewVisible = false
    entry.viewVisibilityGeneration += 1
    entry.view.setVisible(false)
    pauseModelOutput(entry, 'Failed to pause detached terminal output:')
    entry.viewNeedsRecovery = true
    entry.attached = false
    entry.view.unmount()
  }

  function focus(entry: PoolEntry | undefined): void {
    if (entry?.attached && entry.viewVisible && !isModalOpen()) entry.view.focus()
  }

  return { attach, detach, focus, recoverActiveTerminal }
}
