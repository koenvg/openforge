import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IDisposable, type ILinkHandler } from '@xterm/xterm'
import { get, type Readable } from 'svelte/store'
import {
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_LIMIT_MB,
  createItermImageCompatibilityAddon,
  type TerminalImageProtocol,
} from './terminalImages'
import { getTerminalOptions, preloadTerminalFonts } from './terminalOptions'
import { getTerminalTheme, themeMode as defaultThemeMode, type ThemeMode } from './theme'

export type TerminalRuntimeUnlistenFn = () => void

export type { TerminalImageProtocol } from './terminalImages'

export interface TerminalRuntimeEvent<TPayload> {
  payload: TPayload
}

export interface PtyEvent {
  data?: string | null
  instance_id?: number | null
}

export interface TerminalRuntimeHost {
  listenEvent<TPayload>(eventName: string, handler: (event: TerminalRuntimeEvent<TPayload>) => void): Promise<TerminalRuntimeUnlistenFn>
  getPtyBuffer(taskId: string): Promise<string | null>
  writePty(taskId: string, data: string): Promise<void>
  resizePty(taskId: string, cols: number, rows: number): Promise<void>
  openUrl(url: string): Promise<void>
  themeMode?: Readable<ThemeMode>
  loggerName?: string
  enableImages?: boolean
}

export interface PoolEntry {
  taskId: string
  terminal: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  ptyActive: boolean
  needsClear: boolean
  unlisteners: TerminalRuntimeUnlistenFn[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  spawnPending: boolean
  currentPtyInstance: number | null
  hasOutput: boolean
  imageAddon: ImageAddon | null
  imageProtocol: TerminalImageProtocol | null
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
  hasOutput: boolean
}

type ShellLifecycleListener = (state: ShellLifecycleState) => void

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

export function createTerminalRuntime(host: TerminalRuntimeHost) {
  const activeThemeMode = host.themeMode ?? defaultThemeMode

  const pool = new Map<string, PoolEntry>()
  const taskTabSessions = new Map<string, TaskTerminalTabsSession>()
  const shellLifecycleListeners = new Map<string, Set<ShellLifecycleListener>>()
  const openedTerminals = new WeakSet<Terminal>()
  let appEventsReconnectUnlisten: TerminalRuntimeUnlistenFn | null = null
  let appEventsReconnectListenerPending: Promise<void> | null = null
  
  function createDefaultTaskTabsSession(taskId: string): TaskTerminalTabsSession {
    return {
      tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
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
  
  function isValidTerminalDimensions(dimensions: { cols: unknown; rows: unknown } | null | undefined): dimensions is { cols: number; rows: number } {
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
  
    host.resizePty(entry.taskId, entry.terminal.cols, entry.terminal.rows)
      .catch(e => console.error('[terminalPool] resize failed:', e))
  }
  
  function getShellLifecycleStateFromEntry(entry: PoolEntry | undefined): ShellLifecycleState {
    return {
      ptyActive: entry?.ptyActive ?? false,
      shellExited: entry ? !entry.ptyActive && entry.needsClear : false,
      currentPtyInstance: entry?.currentPtyInstance ?? null,
      hasOutput: entry?.hasOutput ?? false,
    }
  }
  
  function notifyShellLifecycleListeners(taskId: string): void {
    const listeners = shellLifecycleListeners.get(taskId)
    if (!listeners || listeners.size === 0) return
  
    const state = getShellLifecycleStateFromEntry(pool.get(taskId))
    for (const listener of listeners) {
      listener(state)
    }
  }
  
  function markShellPtyExited(entry: PoolEntry): void {
    entry.ptyActive = false
    entry.needsClear = true
    notifyShellLifecycleListeners(entry.taskId)
  }
  
  const SHIFT_ENTER_CTRL_J_SEQUENCE = '\n'
  
  function isShellTerminalKey(taskId: string): boolean {
    return /-shell-\d+$/.test(taskId)
  }
  
  function attachAgentTerminalKeyHandler(entry: PoolEntry): void {
    if (isShellTerminalKey(entry.taskId)) return
  
    entry.terminal.attachCustomKeyEventHandler((event) => {
      const isShiftEnter = event.key === 'Enter' && event.shiftKey
      const shouldConsume = isShiftEnter && (event.type === 'keydown' || event.type === 'keypress')
      if (!shouldConsume) {
        return true
      }
  
      event.preventDefault()
      event.stopPropagation()
  
      if (event.type === 'keydown' && entry.ptyActive) {
        host.writePty(entry.taskId, SHIFT_ENTER_CTRL_J_SEQUENCE).catch(e => console.error('[terminalPool] write failed:', e))
      }
  
      return false
    })
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
  
  function openTerminalLink(event: MouseEvent, uri: string): void {
    event.preventDefault()
    event.stopPropagation()
    host.openUrl(uri).catch(error => {
      console.error('[terminalPool] Failed to open terminal link:', error)
    })
  }
  
  function createTerminalLinkHandler(): ILinkHandler {
    return {
      allowNonHttpProtocols: false,
      activate: (event, uri) => openTerminalLink(event, uri),
    }
  }
  
  function loadWebLinksAddon(terminal: Terminal): void {
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      openTerminalLink(event, uri)
    })

    terminal.loadAddon(webLinksAddon)
  }
  
  function loadImageSupport(terminal: Terminal): { imageAddon: ImageAddon | null; imageProtocol: TerminalImageProtocol | null } {
    if (host.enableImages === false) return { imageAddon: null, imageProtocol: null }

    const imageAddon = new ImageAddon({
      enableSizeReports: true,
      pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
      storageLimit: TERMINAL_IMAGE_STORAGE_LIMIT_MB,
      showPlaceholder: true,
      sixelSupport: false,
      iipSupport: true,
      iipSizeLimit: TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
    })

    try {
      terminal.loadAddon(imageAddon)
    } catch (error) {
      try {
        imageAddon.dispose()
      } catch (disposeError) {
        console.warn('[terminalPool] Failed to dispose unavailable image addon:', disposeError)
      }
      console.warn('[terminalPool] Inline images unavailable; keeping text fallbacks:', error)
      return { imageAddon: null, imageProtocol: null }
    }

    const compatibilityAddon = createItermImageCompatibilityAddon()
    try {
      // Register after ImageAddon: xterm checks the newest OSC handler first,
      // allowing WebP conversion/validation before supported IIP reaches ImageAddon.
      terminal.loadAddon(compatibilityAddon)
      return { imageAddon, imageProtocol: 'iterm2' }
    } catch (error) {
      compatibilityAddon.dispose()
      try {
        imageAddon.dispose()
      } catch (disposeError) {
        console.warn('[terminalPool] Failed to dispose unvalidated image addon:', disposeError)
      }
      console.warn('[terminalPool] Inline image validation unavailable; keeping text fallbacks:', error)
      return { imageAddon: null, imageProtocol: null }
    }
  }

  function resetTerminal(entry: PoolEntry): void {
    entry.imageAddon?.reset()
    entry.terminal.reset()
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
      const buffered = await host.getPtyBuffer(entry.taskId)
      if (!buffered) return
  
      resetTerminal(entry)
      entry.needsClear = false
      entry.terminal.write(buffered)
      entry.ptyActive = true
      entry.hasOutput = true
      notifyShellLifecycleListeners(entry.taskId)
      if (entry.attached) refreshTerminal(entry)
    } catch (e) {
      console.error('[terminalPool] Failed to replay PTY buffer after app event reconnect:', e)
    }
  }
  
  async function replayPtyBuffersForActiveTerminals(): Promise<void> {
    await Promise.all([...pool.values()].map(entry => replayPtyBuffer(entry)))
  }
  
  async function ensureAppEventsReconnectListener(): Promise<void> {
    if (appEventsReconnectUnlisten) return
    if (appEventsReconnectListenerPending) return appEventsReconnectListenerPending
  
    appEventsReconnectListenerPending = host.listenEvent(APP_EVENTS_RECONNECTED_EVENT, () => {
      void replayPtyBuffersForActiveTerminals()
    })
      .then((unlisten) => {
        if (pool.size === 0) {
          unlisten()
          return
        }
        appEventsReconnectUnlisten = unlisten
      })
      .finally(() => {
        appEventsReconnectListenerPending = null
      })
  
    return appEventsReconnectListenerPending
  }
  
  function releaseAppEventsReconnectListenerIfIdle(): void {
    if (pool.size > 0) return
    appEventsReconnectUnlisten?.()
    appEventsReconnectUnlisten = null
    appEventsReconnectListenerPending = null
  }
  
  async function acquire(taskId: string): Promise<PoolEntry> {
    const existing = pool.get(taskId)
    if (existing) return existing
  
    const terminal = new Terminal({
      ...getTerminalOptions(get(activeThemeMode)),
      linkHandler: createTerminalLinkHandler(),
    })
  
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    loadWebLinksAddon(terminal)
    const imageSupport = loadImageSupport(terminal)
  
    const hostDiv = createHostDiv()
  
    await preloadTerminalFonts()
  
    // NOTE: terminal.open() is deferred to the first attach() call so that
    // xterm.js measures character dimensions against a DOM-attached container
    // with real pixel dimensions. Calling open() on a detached 0×0 div causes
    // CharSizeService to produce invalid measurements, making fitAddon unable
    // to compute proper terminal dimensions. xterm.js buffers write() calls
    // until open() is invoked, so buffer replay and listeners work correctly.
  
    const entry: PoolEntry = {
      taskId,
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
      hasOutput: false,
      imageAddon: imageSupport.imageAddon,
      imageProtocol: imageSupport.imageProtocol,
      webglAddon: null,
      webglContextLossDisposable: null,
      webglUnavailable: false,
    }
  
    // Replay buffered output from backend
    try {
      const buffered = await host.getPtyBuffer(taskId)
      if (buffered) {
        terminal.write(buffered)
        entry.ptyActive = true
        entry.hasOutput = true
      }
    } catch (e) {
      console.error('[terminalPool] Failed to get PTY buffer:', e)
    }
  
    // Persistent PTY output listener (survives component unmount)
    entry.unlisteners.push(await host.listenEvent<PtyEvent>(`pty-output-${taskId}`, (event) => {
      const instanceId = event.payload.instance_id
      if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) {
        return
      }
      if (event.payload.data) {
        if (entry.needsClear) {
          resetTerminal(entry)
          entry.needsClear = false
        }
        entry.terminal.write(event.payload.data)
        entry.ptyActive = true
        entry.hasOutput = true
        notifyShellLifecycleListeners(taskId)
      }
    }))
  
    // Persistent PTY exit listener
    entry.unlisteners.push(await host.listenEvent<PtyEvent>(`pty-exit-${taskId}`, (event) => {
      const instanceId = event.payload.instance_id
      if (instanceId != null && entry.currentPtyInstance != null && instanceId !== entry.currentPtyInstance) {
        return
      }
      markShellPtyExited(entry)
    }))
  
    attachAgentTerminalKeyHandler(entry)
  
    // Terminal onData -> write to PTY (guarded by ptyActive)
    terminal.onData((data: string) => {
      if (entry.ptyActive) {
        host.writePty(taskId, data).catch(e => console.error('[terminalPool] write failed:', e))
      }
    })
  
    pool.set(taskId, entry)
    await ensureAppEventsReconnectListener()
    return entry
  }
  
  async function attach(entry: PoolEntry, wrapperEl: HTMLDivElement): Promise<void> {
    if (entry.attached && entry.hostDiv.parentNode === wrapperEl) return
  
    wrapperEl.appendChild(entry.hostDiv)
    entry.attached = true
  
    // Open terminal into the now-DOM-attached hostDiv (first attach only).
    // Deferred from acquire() so xterm.js CharSizeService measures character
    // dimensions against a container with real pixel dimensions.
    if (!openedTerminals.has(entry.terminal)) {
      entry.terminal.open(entry.hostDiv)
      openedTerminals.add(entry.terminal)
      // Load WebGL only after xterm has opened against a DOM-attached host with
      // preloaded fonts. The WebGL renderer builds its glyph atlas from measured
      // font/cell metrics; loading it during acquire() can produce shifted glyphs.
      loadWebglAddon(entry)
    }
  
    // Set up ResizeObserver
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
  
    // Set up IntersectionObserver for visibility-based refresh
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
  
  async function recoverActiveTerminal(entry: PoolEntry): Promise<void> {
    if (!entry.attached) return
    await waitForInitialFit(entry)
  }
  
  function detach(entry: PoolEntry): void {
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
  
    // Remove host div from DOM but keep the terminal alive
    if (entry.hostDiv.parentNode) {
      entry.hostDiv.parentNode.removeChild(entry.hostDiv)
    }
  
    entry.attached = false
  }
  
  function release(taskId: string): void {
    const entry = pool.get(taskId)
    if (!entry) return
  
    detach(entry)
    entry.unlisteners.forEach(fn => {
      fn()
    })
    entry.unlisteners.length = 0
    disposeWebglContextLossListener(entry)
    entry.terminal.dispose()
    pool.delete(taskId)
    shellLifecycleListeners.delete(taskId)
    releaseAppEventsReconnectListenerIfIdle()
  }
  
  function shouldSpawnPty(entry: PoolEntry): boolean {
    return !entry.ptyActive && !entry.spawnPending && !entry.needsClear
  }
  
  function markPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = true
    entry.hasOutput = false
  }
  
  function clearPtySpawnPending(entry: PoolEntry): void {
    entry.spawnPending = false
  }
  
  function setCurrentPtyInstance(entry: PoolEntry, instanceId: number | null): void {
    entry.currentPtyInstance = instanceId
  }
  
  function markShellPtyStarted(entry: PoolEntry, instanceId: number): void {
    entry.currentPtyInstance = instanceId
    entry.ptyActive = true
    entry.needsClear = false
    notifyShellLifecycleListeners(entry.taskId)
  }
  
  function subscribeShellLifecycle(taskId: string, listener: ShellLifecycleListener): TerminalRuntimeUnlistenFn {
    let listeners = shellLifecycleListeners.get(taskId)
    if (!listeners) {
      listeners = new Set()
      shellLifecycleListeners.set(taskId, listeners)
    }
  
    listeners.add(listener)
  
    return () => {
      const current = shellLifecycleListeners.get(taskId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) shellLifecycleListeners.delete(taskId)
    }
  }
  
  function isShellExited(taskId: string): boolean {
    const entry = pool.get(taskId)
    if (!entry) return false
    return !entry.ptyActive && entry.needsClear
  }
  
  function getShellLifecycleState(taskId: string): ShellLifecycleState {
    return getShellLifecycleStateFromEntry(pool.get(taskId))
  }
  
  function updateShellLifecycleState(taskId: string, state: ShellLifecycleState): void {
    const entry = pool.get(taskId)
    if (!entry) return
  
    entry.ptyActive = state.ptyActive
    entry.needsClear = state.shellExited
    entry.currentPtyInstance = state.currentPtyInstance
    entry.hasOutput = state.hasOutput
    notifyShellLifecycleListeners(taskId)
  }
  
  function getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession {
    const existing = taskTabSessions.get(taskId)
    if (existing) return existing
  
    const session = createDefaultTaskTabsSession(taskId)
    taskTabSessions.set(taskId, session)
    return session
  }
  
  function updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void {
    taskTabSessions.set(taskId, session)
  }
  
  function clearTaskTerminalTabsSession(taskId: string): void {
    taskTabSessions.delete(taskId)
  }
  
  function releaseAll(): void {
    for (const taskId of [...pool.keys()]) {
      release(taskId)
    }
    taskTabSessions.clear()
    shellLifecycleListeners.clear()
    releaseAppEventsReconnectListenerIfIdle()
  }
  
  function releaseAllForTask(taskId: string): number {
    let count = 0
    const keysToRelease: string[] = []
  
    for (const key of pool.keys()) {
      if (key.startsWith(`${taskId}-shell-`)) {
        keysToRelease.push(key)
      }
    }
  
    for (const key of keysToRelease) {
      release(key)
      count++
    }
  
    return count
  }
  
  activeThemeMode.subscribe((mode) => {
    const theme = getTerminalTheme(mode)
    for (const entry of pool.values()) {
      entry.terminal.options.theme = theme
    }
  })
  
  function focusTerminal(taskId: string): void {
    const entry = pool.get(taskId)
    if (entry?.attached) {
      entry.terminal.focus()
    }
  }
  
  function hasTerminal(taskId: string): boolean {
    return pool.has(taskId)
  }

  function isPtyActive(taskId: string): boolean {
    return pool.get(taskId)?.ptyActive ?? false
  }

  function getTerminalImageProtocol(entry: PoolEntry): TerminalImageProtocol | null {
    return entry.imageProtocol
  }

  function _getPool(): Map<string, PoolEntry> {
    return pool
  }

  return {
    isValidTerminalDimensions,
    getTerminalImageProtocol,
    acquire,
    attach,
    detach,
    release,
    resetTerminal,
    shouldSpawnPty,
    markPtySpawnPending,
    clearPtySpawnPending,
    setCurrentPtyInstance,
    markShellPtyStarted,
    subscribeShellLifecycle,
    isShellExited,
    getShellLifecycleState,
    updateShellLifecycleState,
    getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession,
    clearTaskTerminalTabsSession,
    releaseAll,
    releaseAllForTask,
    focusTerminal,
    hasTerminal,
    isPtyActive,
    recoverActiveTerminal,
    replayPtyBuffersForActiveTerminals,
    _getPool,
  }
}

export type TerminalRuntime = ReturnType<typeof createTerminalRuntime>
