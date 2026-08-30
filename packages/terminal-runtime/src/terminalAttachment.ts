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
) {
  const pendingInitialFits = new WeakMap<PoolEntry, Set<() => void>>()

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

  function createAttachment(entry: PoolEntry, generation: number): TerminalViewAttachment {
    return {
      generation,
      detach: () => detach(entry, generation),
    }
  }

  async function attach(
    entry: PoolEntry,
    wrapperEl: HTMLDivElement,
  ): Promise<TerminalViewAttachment> {
    if (entry.attached && entry.view.isMountedIn(wrapperEl)) {
      return createAttachment(entry, entry.attachmentGeneration)
    }
    if (entry.attached) detach(entry)

    entry.attachmentGeneration += 1
    const generation = entry.attachmentGeneration
    entry.view.mount(wrapperEl)
    entry.attached = true
    if (!entry.resizeObserver) {
      entry.resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect
        if (width === 0 || height === 0) return
        if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
        entry.resizeTimeout = setTimeout(() => {
          entry.resizeTimeout = null
          safeFit(entry)
          syncPtySize(entry)
        }, 100)
      })
    }
    entry.resizeObserver.disconnect()
    entry.resizeObserver.observe(entry.view.resizeTarget)

    if (!entry.visibilityObserver) {
      entry.visibilityObserver = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1]
        if (!last.isIntersecting) return
        requestAnimationFrame(() => {
          safeFit(entry)
          syncPtySize(entry)
          refreshAndFocus(entry)
        })
      }, { threshold: 0 })
    }
    entry.visibilityObserver.disconnect()
    entry.visibilityObserver.observe(wrapperEl)

    await waitForInitialFit(entry, generation)
    return createAttachment(entry, generation)
  }

  async function recoverActiveTerminal(entry: PoolEntry, signal?: AbortSignal): Promise<void> {
    if (!entry.attached) return
    await waitForInitialFit(entry, entry.attachmentGeneration, signal)
  }

  function detach(
    entry: PoolEntry,
    attachmentGeneration = entry.attachmentGeneration,
  ): void {
    if (!entry.attached || attachmentGeneration !== entry.attachmentGeneration) return
    cancelPendingInitialFits(entry)

    if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
    entry.resizeTimeout = null
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = null
    entry.visibilityObserver?.disconnect()
    entry.visibilityObserver = null
    entry.view.unmount()
    entry.attached = false
  }

  function focus(entry: PoolEntry | undefined): void {
    if (entry?.attached && !isModalOpen()) entry.view.focus()
  }

  return { attach, detach, focus, recoverActiveTerminal }
}
