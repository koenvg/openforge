import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IDisposable, type ILinkHandler } from '@xterm/xterm'
import type { Disposable, FrontendOpenForgeAPI, ShellExitEvent, ShellOutputEvent, ShellSessionIdentity } from '@openforge/plugin-sdk/frontend'
import { get } from 'svelte/store'
import { getTerminalOptions, preloadTerminalFonts } from './terminalOptions'
import { getTerminalTheme, themeMode } from './theme'

export interface TerminalPoolServices {
  shell: FrontendOpenForgeAPI['shell']
  system: FrontendOpenForgeAPI['system']
}

export interface PoolEntry {
  session: ShellSessionIdentity
  services: TerminalPoolServices
  terminal: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  ptyActive: boolean
  needsClear: boolean
  unlisteners: Disposable[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  spawnPending: boolean
  currentPtyInstance: number | null
  webglAddon: WebglAddon | null
  webglContextLossDisposable: IDisposable | null
  webglUnavailable: boolean
}

export interface TerminalTab {
  index: number
  key: string
  label: string
}

export interface TaskTerminalTabsSession {
  tabs: TerminalTab[]
  activeTabIndex: number
  nextIndex: number
}

export interface ShellLifecycleState {
  ptyActive: boolean
  shellExited: boolean
  currentPtyInstance: number | null
}

type ShellLifecycleListener = (state: ShellLifecycleState) => void

const pool = new Map<string, PoolEntry>()
const taskTabSessions = new Map<string, TaskTerminalTabsSession>()
const shellLifecycleListeners = new Map<string, Set<ShellLifecycleListener>>()
const openedTerminals = new WeakSet<Terminal>()

function createDefaultTaskTabsSession(taskId: string): TaskTerminalTabsSession {
  return {
    tabs: [{ index: 0, key: `${taskId}:0`, label: 'Shell 1' }],
    activeTabIndex: 0,
    nextIndex: 1,
  }
}

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.width = '100%'
  div.style.height = '100%'
  return div
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function isValidTerminalDimensions(dimensions: { cols: unknown; rows: unknown } | null | undefined): dimensions is { cols: number; rows: number } {
  if (!dimensions) return false
  if (typeof dimensions.cols !== 'number' || typeof dimensions.rows !== 'number') return false
  return !Number.isNaN(dimensions.cols) && !Number.isNaN(dimensions.rows)
}

function safeFit(entry: PoolEntry): boolean {
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

function syncPtySize(entry: PoolEntry): void {
  if (!entry.ptyActive) return

  entry.services.shell.resize({ session: entry.session, cols: entry.terminal.cols, rows: entry.terminal.rows })
    .catch(e => console.error('[terminalPool] resize failed:', e))
}

function getShellLifecycleStateFromEntry(entry: PoolEntry | undefined): ShellLifecycleState {
  return {
    ptyActive: entry?.ptyActive ?? false,
    shellExited: entry ? !entry.ptyActive && entry.needsClear : false,
    currentPtyInstance: entry?.currentPtyInstance ?? null,
  }
}

function notifyShellLifecycleListeners(sessionId: string): void {
  const listeners = shellLifecycleListeners.get(sessionId)
  if (!listeners || listeners.size === 0) return

  const state = getShellLifecycleStateFromEntry(pool.get(sessionId))
  for (const listener of listeners) {
    listener(state)
  }
}

function markShellPtyExited(entry: PoolEntry): void {
  entry.ptyActive = false
  entry.needsClear = true
  notifyShellLifecycleListeners(entry.session.id)
}

function waitForInitialFit(entry: PoolEntry): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (!entry.attached) {
        resolve()
        return
      }

      if (safeFit(entry)) {
        refreshAndFocus(entry)
        syncPtySize(entry)
        resolve()
        return
      }

      void waitForInitialFit(entry).then(() => resolve())
    })
  })
}

function openTerminalLink(entry: PoolEntry, event: MouseEvent, uri: string): void {
  event.preventDefault()
  event.stopPropagation()
  entry.services.system.openUrl(uri).catch(error => {
    console.error('[terminalPool] Failed to open terminal link:', error)
  })
}

function createTerminalLinkHandler(entry: PoolEntry): ILinkHandler {
  return {
    allowNonHttpProtocols: false,
    activate: (event, uri) => openTerminalLink(entry, event, uri),
  }
}

function loadWebLinksAddon(entry: PoolEntry): void {
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    openTerminalLink(entry, event, uri)
  })

  entry.terminal.loadAddon(webLinksAddon)
}

function disposeWebglContextLossListener(entry: PoolEntry): void {
  try {
    entry.webglContextLossDisposable?.dispose()
  } catch (error) {
    console.warn('[terminalPool] Failed to dispose WebGL context loss listener:', error)
  } finally {
    entry.webglContextLossDisposable = null
  }
}

function disposeWebglAddon(entry: PoolEntry): void {
  const webglAddon = entry.webglAddon
  disposeWebglContextLossListener(entry)
  entry.webglAddon = null

  try {
    webglAddon?.dispose()
  } catch (error) {
    console.warn('[terminalPool] Failed to dispose WebGL renderer addon:', error)
  }
}

function recoverFromWebglContextLoss(entry: PoolEntry): void {
  if (!entry.webglAddon) return

  console.warn('[terminalPool] WebGL renderer context lost; falling back to the default renderer.')
  disposeWebglAddon(entry)
  entry.webglUnavailable = true

  if (entry.attached) {
    safeFit(entry)
    refreshTerminal(entry)
  }
}

function loadWebglAddon(entry: PoolEntry): void {
  if (entry.webglAddon || entry.webglUnavailable) return

  let webglAddon: WebglAddon | null = null

  try {
    webglAddon = new WebglAddon()
    entry.webglAddon = webglAddon
    entry.webglContextLossDisposable = webglAddon.onContextLoss(() => {
      recoverFromWebglContextLoss(entry)
    })
    entry.terminal.loadAddon(webglAddon)
  } catch (error) {
    if (!entry.webglUnavailable) {
      if (entry.webglAddon) {
        disposeWebglAddon(entry)
      } else {
        try {
          webglAddon?.dispose()
        } catch (disposeError) {
          console.warn('[terminalPool] Failed to dispose unavailable WebGL renderer addon:', disposeError)
        }
      }
      entry.webglAddon = null
      entry.webglContextLossDisposable = null
      entry.webglUnavailable = true
    }
    console.warn('[terminalPool] WebGL renderer unavailable; falling back to the default renderer:', error)
  }
}

async function replayPtyBuffer(entry: PoolEntry): Promise<void> {
  if (entry.needsClear) return

  try {
    const buffered = await entry.services.shell.getBuffer({ session: entry.session })
    if (!buffered) return

    entry.terminal.reset()
    entry.needsClear = false
    entry.terminal.write(buffered)
    entry.ptyActive = true
    notifyShellLifecycleListeners(entry.session.id)
    if (entry.attached) refreshTerminal(entry)
  } catch (e) {
    console.error('[terminalPool] Failed to replay PTY buffer:', e)
  }
}

export async function replayPtyBuffersForActiveTerminals(): Promise<void> {
  await Promise.all([...pool.values()].map(entry => replayPtyBuffer(entry)))
}

function shouldAcceptShellEvent(entry: PoolEntry, event: ShellOutputEvent | ShellExitEvent): boolean {
  return event.instanceId == null || entry.currentPtyInstance == null || event.instanceId === entry.currentPtyInstance
}

function applyShellOutput(entry: PoolEntry, event: ShellOutputEvent): void {
  if (!shouldAcceptShellEvent(entry, event)) return

  if (event.data) {
    if (entry.needsClear) {
      entry.terminal.reset()
      entry.needsClear = false
    }
    entry.terminal.write(event.data)
    entry.ptyActive = true
    notifyShellLifecycleListeners(entry.session.id)
  }
}

function applyShellExit(entry: PoolEntry, event: ShellExitEvent): void {
  if (!shouldAcceptShellEvent(entry, event)) return
  markShellPtyExited(entry)
}

export async function acquire(session: ShellSessionIdentity, services: TerminalPoolServices): Promise<PoolEntry> {
  const existing = pool.get(session.id)
  if (existing) {
    existing.services = services
    return existing
  }

  const terminal = new Terminal({
    ...getTerminalOptions(get(themeMode)),
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  const hostDiv = createHostDiv()

  await preloadTerminalFonts()

  const entry: PoolEntry = {
    session,
    services,
    terminal,
    fitAddon,
    hostDiv,
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
    spawnPending: false,
    currentPtyInstance: null,
    webglAddon: null,
    webglContextLossDisposable: null,
    webglUnavailable: false,
  }

  terminal.options.linkHandler = createTerminalLinkHandler(entry)
  loadWebLinksAddon(entry)

  try {
    const buffered = await services.shell.getBuffer({ session })
    if (buffered) {
      terminal.write(buffered)
      entry.ptyActive = true
    }
  } catch (e) {
    console.error('[terminalPool] Failed to get PTY buffer:', e)
  }

  entry.unlisteners.push(services.shell.onOutput(session, (event) => applyShellOutput(entry, event)))
  entry.unlisteners.push(services.shell.onExit(session, (event) => applyShellExit(entry, event)))

  terminal.onData((data: string) => {
    if (entry.ptyActive) {
      entry.services.shell.write({ session: entry.session, data }).catch(e => console.error('[terminalPool] write failed:', e))
    }
  })

  pool.set(session.id, entry)
  return entry
}

export async function attach(entry: PoolEntry, wrapperEl: HTMLDivElement): Promise<void> {
  if (entry.attached && entry.hostDiv.parentNode === wrapperEl) return

  wrapperEl.appendChild(entry.hostDiv)
  entry.attached = true

  if (!openedTerminals.has(entry.terminal)) {
    entry.terminal.open(entry.hostDiv)
    openedTerminals.add(entry.terminal)
    loadWebglAddon(entry)
  }

  if (!entry.resizeObserver) {
    entry.resizeObserver = new ResizeObserver((entries) => {
      if (!entry.hostDiv || !entry.terminal) return
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
      if (last.isIntersecting) {
        requestAnimationFrame(() => {
          safeFit(entry)
          syncPtySize(entry)
          refreshAndFocus(entry)
        })
      }
    }, { threshold: 0 })
    entry.visibilityObserver.observe(entry.hostDiv)
  }

  await waitForInitialFit(entry)
}

export async function recoverActiveTerminal(entry: PoolEntry): Promise<void> {
  if (!entry.attached) return
  await waitForInitialFit(entry)
}

export function detach(entry: PoolEntry): void {
  if (!entry.attached) return

  if (entry.resizeTimeout) clearTimeout(entry.resizeTimeout)
  entry.resizeTimeout = null

  if (entry.resizeObserver) {
    entry.resizeObserver.disconnect()
    entry.resizeObserver = null
  }

  if (entry.visibilityObserver) {
    entry.visibilityObserver.disconnect()
    entry.visibilityObserver = null
  }

  if (entry.hostDiv.parentNode) {
    entry.hostDiv.parentNode.removeChild(entry.hostDiv)
  }

  entry.attached = false
}

export function release(sessionId: string): void {
  const entry = pool.get(sessionId)
  if (!entry) return

  detach(entry)
  entry.unlisteners.forEach(fn => {
    void fn.dispose()
  })
  entry.unlisteners.length = 0
  disposeWebglContextLossListener(entry)
  entry.terminal.dispose()
  pool.delete(sessionId)
  shellLifecycleListeners.delete(sessionId)
}

export function shouldSpawnPty(entry: PoolEntry): boolean {
  return !entry.ptyActive && !entry.spawnPending && !entry.needsClear
}

export function markPtySpawnPending(entry: PoolEntry): void {
  entry.spawnPending = true
}

export function clearPtySpawnPending(entry: PoolEntry): void {
  entry.spawnPending = false
}

export function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
  entry.currentPtyInstance = instanceId
}

export function markShellPtyStarted(entry: PoolEntry, instanceId: number): void {
  entry.currentPtyInstance = instanceId
  entry.ptyActive = true
  entry.needsClear = false
  notifyShellLifecycleListeners(entry.session.id)
}

export function subscribeShellLifecycle(sessionId: string, listener: ShellLifecycleListener): () => void {
  let listeners = shellLifecycleListeners.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    shellLifecycleListeners.set(sessionId, listeners)
  }

  listeners.add(listener)

  return () => {
    const current = shellLifecycleListeners.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) shellLifecycleListeners.delete(sessionId)
  }
}

export function isShellExited(sessionId: string): boolean {
  const entry = pool.get(sessionId)
  if (!entry) return false
  return !entry.ptyActive && entry.needsClear
}

export function getShellLifecycleState(sessionId: string): ShellLifecycleState {
  return getShellLifecycleStateFromEntry(pool.get(sessionId))
}

export function updateShellLifecycleState(sessionId: string, state: ShellLifecycleState): void {
  const entry = pool.get(sessionId)
  if (!entry) return

  entry.ptyActive = state.ptyActive
  entry.needsClear = state.shellExited
  entry.currentPtyInstance = state.currentPtyInstance
  notifyShellLifecycleListeners(sessionId)
}

export function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
  const existing = taskTabSessions.get(taskId)
  if (existing) return existing

  const session = createDefaultTaskTabsSession(taskId)
  taskTabSessions.set(taskId, session)
  return session
}

export function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
  taskTabSessions.set(taskId, session)
}

export function clearTaskTerminalTabsSession(taskId: string): void {
  taskTabSessions.delete(taskId)
}

export function releaseAll(): void {
  for (const sessionId of [...pool.keys()]) {
    release(sessionId)
  }
  taskTabSessions.clear()
  shellLifecycleListeners.clear()
}

export function releaseAllForTask(taskId: string): number {
  let count = 0
  const keysToRelease: string[] = []

  for (const [sessionId, entry] of pool.entries()) {
    if (entry.session.origin.kind === 'task' && entry.session.origin.taskId === taskId) {
      keysToRelease.push(sessionId)
    }
  }

  for (const sessionId of keysToRelease) {
    release(sessionId)
    count++
  }

  return count
}

themeMode.subscribe((mode) => {
  const theme = getTerminalTheme(mode)
  for (const entry of pool.values()) {
    entry.terminal.options.theme = theme
  }
})

export function focusTerminal(sessionId: string): void {
  const entry = pool.get(sessionId)
  if (entry?.attached) {
    entry.terminal.focus()
  }
}

export function isPtyActive(sessionId: string): boolean {
  return pool.get(sessionId)?.ptyActive ?? false
}

export function _getPool(): Map<string, PoolEntry> {
  return pool
}
