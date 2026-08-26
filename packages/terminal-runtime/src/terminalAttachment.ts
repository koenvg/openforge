import { terminalLogMessage } from './terminalLogging'
import type { TerminalTransport } from './terminalTransport'
import type { PoolEntry, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

const MIN_PTY_DIMENSION = 1
const MAX_PTY_DIMENSION = 0xFFFF

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
  function syncPtySize(entry: PoolEntry): void {
    if (!entry.ptyActive) return
    const dimensions = entry.view.geometry
    if (!isValidTerminalDimensions(dimensions)) return
    transport.resize(entry.shellSessionKey, dimensions)
      .catch(error => console.error(terminalLogMessage(environment.loggerName, 'resize failed:'), error))
  }

  function waitForInitialFit(entry: PoolEntry, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        if (signal?.aborted || !entry.attached) {
          resolve()
          return
        }
        if (safeFit(entry)) {
          refreshAndFocus(entry)
          syncPtySize(entry)
          resolve()
          return
        }
        void waitForInitialFit(entry, signal).then(resolve)
      })
    })
  }

  async function attach(entry: PoolEntry, wrapperEl: HTMLDivElement): Promise<void> {
    if (entry.attached && entry.view.isMountedIn(wrapperEl)) return

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

    await waitForInitialFit(entry)
  }

  async function recoverActiveTerminal(entry: PoolEntry, signal?: AbortSignal): Promise<void> {
    if (!entry.attached) return
    await waitForInitialFit(entry, signal)
  }

  function detach(entry: PoolEntry): void {
    if (!entry.attached) return

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
