import { loadWebglAddon } from './terminalRendering'
import type { PoolEntry, TerminalRuntimeHost } from './terminalRuntimeTypes'

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function isValidTerminalDimensions(
  dimensions: { cols: unknown; rows: unknown } | null | undefined,
): dimensions is { cols: number; rows: number } {
  if (!dimensions) return false
  if (typeof dimensions.cols !== 'number' || typeof dimensions.rows !== 'number') return false
  return !Number.isNaN(dimensions.cols) && !Number.isNaN(dimensions.rows)
}

export function safeFit(entry: PoolEntry): boolean {
  if (!entry.fitAddon || !entry.hostDiv) return false
  if (entry.hostDiv.clientWidth === 0 || entry.hostDiv.clientHeight === 0) return false
  const proposed = entry.fitAddon.proposeDimensions()
  if (!isValidTerminalDimensions(proposed)) return false
  entry.fitAddon.fit()
  return true
}

function refreshTerminal(entry: PoolEntry): void {
  entry.terminal.refresh(0, (entry.terminal.rows ?? 1) - 1)
}

function refreshAndFocus(entry: PoolEntry): void {
  refreshTerminal(entry)
  if (!isModalOpen()) entry.terminal.focus()
}

export function createTerminalAttachmentController(host: TerminalRuntimeHost) {
  const openedTerminals = new WeakSet<PoolEntry['terminal']>()

  function syncPtySize(entry: PoolEntry): void {
    if (!entry.ptyActive) return
    host.resizePty(entry.taskId, entry.terminal.cols, entry.terminal.rows)
      .catch(error => console.error('[terminalPool] resize failed:', error))
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
    if (entry.attached && entry.hostDiv.parentNode === wrapperEl) return

    wrapperEl.appendChild(entry.hostDiv)
    entry.attached = true

    if (!openedTerminals.has(entry.terminal)) {
      entry.terminal.open(entry.hostDiv)
      openedTerminals.add(entry.terminal)
      loadWebglAddon(entry, () => {
        if (!entry.attached) return
        safeFit(entry)
        refreshTerminal(entry)
      })
    }

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
      entry.resizeObserver.observe(entry.hostDiv)
    }

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
      entry.visibilityObserver.observe(entry.hostDiv)
    }

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
    entry.hostDiv.parentNode?.removeChild(entry.hostDiv)
    entry.attached = false
  }

  function focus(entry: PoolEntry | undefined): void {
    if (entry?.attached && !isModalOpen()) entry.terminal.focus()
  }

  return { attach, detach, focus, recoverActiveTerminal }
}
