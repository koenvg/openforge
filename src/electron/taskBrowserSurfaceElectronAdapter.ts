import { BrowserWindow, WebContentsView, app, session as electronSession } from 'electron'
import type { Session, WebContents } from 'electron'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserNavigationError,
  TaskBrowserSurfaceCreateOptions,
} from './taskBrowserSurfaceManager.js'

function allowedTopLevelUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isAbortedNavigationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? error.code : undefined
  return code === -3 || code === 'ERR_ABORTED'
}

function integerBounds(bounds: TaskBrowserBounds): TaskBrowserBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }
}

const securedTaskBrowserSessions = new WeakSet<Session>()

class ElectronNativeTaskBrowserSurface implements NativeTaskBrowserSurface {
  private readonly view: WebContentsView
  private readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private attachedWindow: BrowserWindow | null = null
  private navigationError: TaskBrowserNavigationError | null = null
  private destroyed = false

  constructor(options: TaskBrowserSurfaceCreateOptions) {
    this.view = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        partition: options.partition,
        devTools: !app.isPackaged,
      },
    })
    const browserSession = this.view.webContents.session
    if (!securedTaskBrowserSessions.has(browserSession)) {
      securedTaskBrowserSessions.add(browserSession)
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
      browserSession.on('will-download', (_event, item) => item.cancel())
    }
    this.configureSecurityPolicy(this.view.webContents)
    this.configureStatePublication(this.view.webContents)
  }

  getState(): TaskBrowserNativeState {
    if (this.destroyed) {
      return {
        url: 'about:blank',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: this.navigationError ? { ...this.navigationError } : null,
      }
    }
    const contents = this.view.webContents
    return {
      url: contents.getURL() || 'about:blank',
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: this.navigationError ? { ...this.navigationError } : null,
    }
  }

  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async loadURL(url: string): Promise<void> {
    this.navigationError = null
    try {
      await this.view.webContents.loadURL(url)
    } catch (error) {
      if (!this.navigationError && !isAbortedNavigationError(error)) {
        this.navigationError = {
          code: 'ERR_FAILED',
          message: error instanceof Error ? error.message : String(error),
          url,
        }
      }
    }
    this.publish()
  }

  attach(windowId: number, bounds: TaskBrowserBounds): void {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) throw new Error('Owning OpenForge window is unavailable')
    if (this.attachedWindow !== window) {
      this.detach()
      window.contentView.addChildView(this.view)
      this.attachedWindow = window
    }
    this.view.setBounds(integerBounds(bounds))
    this.view.webContents.setBackgroundThrottling(false)
  }

  detach(): void {
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      this.attachedWindow.contentView.removeChildView(this.view)
    }
    this.attachedWindow = null
    if (!this.destroyed) this.view.webContents.setBackgroundThrottling(true)
  }

  destroy(): void {
    if (this.destroyed) return
    this.detach()
    this.destroyed = true
    this.listeners.clear()
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async goBack(): Promise<void> {
    if (this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    if (this.view.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward()
  }

  async reload(): Promise<void> {
    this.navigationError = null
    this.view.webContents.reload()
  }

  stop(): void {
    this.view.webContents.stop()
    this.publish()
  }

  private configureSecurityPolicy(contents: WebContents): void {
    contents.on('will-navigate', (event, url) => {
      if (!allowedTopLevelUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowedTopLevelUrl(url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  private configureStatePublication(contents: WebContents): void {
    contents.on('did-start-loading', () => {
      this.navigationError = null
      this.publish()
    })
    contents.on('did-stop-loading', () => this.publish())
    contents.on('did-navigate', () => this.publish())
    contents.on('did-navigate-in-page', () => this.publish())
    contents.on('page-title-updated', () => this.publish())
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      this.navigationError = {
        code: String(errorCode),
        message: errorDescription,
        url: validatedURL,
      }
      this.publish()
    })
  }

  private publish(): void {
    if (this.destroyed) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

export class ElectronTaskBrowserSurfaceFactory implements NativeTaskBrowserSurfaceFactory {
  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface {
    return new ElectronNativeTaskBrowserSurface(options)
  }

  async clearSession(partition: string): Promise<void> {
    const browserSession = electronSession.fromPartition(partition)
    await browserSession.clearStorageData()
    await browserSession.clearCache()
  }
}
