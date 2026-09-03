import { BrowserWindow, WebContentsView, session as electronSession } from 'electron'
import type { Session, WebContents } from 'electron'
import { openTaskBrowserDevTools } from './taskBrowserDevTools.js'
import { TaskBrowserDownloadManager } from './taskBrowserDownloads.js'
import {
  DENY_TASK_BROWSER_PERMISSIONS,
  permissionRouterFor,
  type ElectronTaskBrowserPermissionRouter,
} from './taskBrowserPermissionRouter.js'
import {
  TaskBrowserSecurityPolicy,
  taskBrowserWebPreferences,
} from './taskBrowserSecurityPolicy.js'
import { TaskBrowserVisualFeedbackController } from './taskBrowserVisualFeedback.js'
import { TaskBrowserSurfaceError, integerTaskBrowserBounds } from './taskBrowserSurfaceManager.js'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserDevToolsPanel,
  TaskBrowserNavigationError,
  TaskBrowserSurfaceCreateOptions,
  TaskBrowserSurfaceVisualFeedback,
  TaskBrowserVisualFeedbackAction,
  TaskBrowserVisualFeedbackPresentation,
} from './taskBrowserSurfaceManager.js'

export { sanitizeTaskBrowserDownloadFilename } from './taskBrowserDownloads.js'

/**
 * Zoom factor of the window's own renderer, which is how many device-independent pixels one of the
 * CSS pixels it measures Task Browser Attachment bounds in is worth.
 */
export function electronRendererZoomFactor(windowId: number): number {
  const window = BrowserWindow.fromId(windowId)
  if (!window || window.isDestroyed()) return 1
  const zoomFactor = window.webContents.getZoomFactor()
  return Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
}

function isAbortedNavigationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? error.code : undefined
  return code === -3 || code === 'ERR_ABORTED'
}

class ElectronNativeTaskBrowserSurface implements NativeTaskBrowserSurface {
  private readonly view: WebContentsView
  private readonly browserSession: Session
  private readonly permissionRouter: ElectronTaskBrowserPermissionRouter
  private readonly securityPolicy: TaskBrowserSecurityPolicy
  private readonly downloadManager: TaskBrowserDownloadManager
  private readonly visualFeedback: TaskBrowserVisualFeedbackController
  private readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private attachedWindow: BrowserWindow | null = null
  private navigationError: TaskBrowserNavigationError | null = null
  private destroyed = false

  constructor(private readonly options: TaskBrowserSurfaceCreateOptions) {
    this.view = new WebContentsView({
      webPreferences: taskBrowserWebPreferences(options),
    })
    this.browserSession = this.view.webContents.session
    this.permissionRouter = permissionRouterFor(this.browserSession)
    this.permissionRouter.register(this.view.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    this.visualFeedback = new TaskBrowserVisualFeedbackController(
      this.view.webContents,
      () => this.destroyed,
      () => this.attachedWindow !== null,
    )
    this.securityPolicy = new TaskBrowserSecurityPolicy(
      this.view.webContents,
      this.options,
      this.permissionRouter,
      {
        getAttachedWindow: () => this.attachedWindow,
        isDestroyed: () => this.destroyed,
        onMainFrameNavigation: () => this.visualFeedback.hideForNavigation(),
        cancelVisibleRegionSelection: () => this.visualFeedback.cancelVisibleRegionSelection(),
      },
    )
    this.downloadManager = new TaskBrowserDownloadManager(
      this.browserSession,
      this.options.windowId,
      webContents => !this.destroyed && this.securityPolicy.ownsWebContents(webContents),
    )
    this.configureStatePublication(this.view.webContents)
    this.view.webContents.setBackgroundThrottling(true)
  }

  getState(): TaskBrowserNativeState {
    if (this.destroyed) {
      return {
        url: 'about:blank',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        devToolsOpen: false,
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
      devToolsOpen: contents.isDevToolsOpened(),
      error: this.navigationError ? { ...this.navigationError } : null,
    }
  }

  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onVisualFeedbackAction(listener: (action: TaskBrowserVisualFeedbackAction) => void): () => void {
    return this.visualFeedback.onVisualFeedbackAction(listener)
  }

  async loadURL(url: string): Promise<void> {
    this.navigationError = null
    this.visualFeedback.hideForNavigation()
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
    const nativeBounds = integerTaskBrowserBounds(bounds)
    if (nativeBounds.width === 0 || nativeBounds.height === 0) {
      this.detach()
      return
    }
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) throw new Error('Owning OpenForge window is unavailable')
    if (this.attachedWindow !== window) {
      this.detach()
      window.contentView.addChildView(this.view)
      this.attachedWindow = window
    }
    this.view.setBounds(nativeBounds)
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
    this.securityPolicy.destroy()
    this.downloadManager.destroy()
    this.permissionRouter.unregister(this.view.webContents)
    this.listeners.clear()
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async goBack(): Promise<void> {
    this.visualFeedback.hideForNavigation()
    if (this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    this.visualFeedback.hideForNavigation()
    if (this.view.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward()
  }

  async reload(): Promise<void> {
    this.navigationError = null
    this.visualFeedback.hideForNavigation()
    this.view.webContents.reload()
  }

  stop(): void {
    this.view.webContents.stop()
    this.publish()
  }

  async openDevTools(panel?: TaskBrowserDevToolsPanel): Promise<void> {
    if (this.destroyed || this.view.webContents.isDestroyed()) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    await this.visualFeedback.cancelVisibleRegionSelection()
    await openTaskBrowserDevTools(this.view.webContents, panel)
  }

  async closeDevTools(): Promise<void> {
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    this.view.webContents.closeDevTools()
  }

  selectVisibleRegion() {
    return this.visualFeedback.selectVisibleRegion()
  }

  cancelVisibleRegionSelection(): Promise<void> {
    return this.visualFeedback.cancelVisibleRegionSelection()
  }

  clearVisualFeedback(): Promise<void> {
    return this.visualFeedback.clearVisualFeedback()
  }

  replaceVisualFeedback(
    feedback: readonly TaskBrowserSurfaceVisualFeedback[],
    presentation?: TaskBrowserVisualFeedbackPresentation,
  ): Promise<void> {
    return this.visualFeedback.replaceVisualFeedback(feedback, presentation)
  }

  async captureVisibleViewport() {
    if (this.destroyed) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (this.attachedWindow === null) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before it can be captured')
    }

    await this.visualFeedback.setVisibility('hidden')
    try {
      const image = await this.view.webContents.capturePage()
      const { width, height } = image.getSize()
      const png = image.toPNG()
      if (width <= 0 || height <= 0 || png.byteLength === 0) {
        throw new Error('Electron returned an empty viewport image')
      }
      return { png, width, height }
    } catch (error) {
      if (error instanceof TaskBrowserSurfaceError) throw error
      throw new TaskBrowserSurfaceError(
        'CAPTURE_FAILED',
        `Could not capture the visible Task Browser viewport: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await this.visualFeedback.setVisibility('')
    }
  }

  private configureStatePublication(contents: WebContents): void {
    contents.on('did-start-loading', () => {
      this.navigationError = null
      this.visualFeedback.hideForNavigation()
      this.publish()
    })
    contents.on('did-stop-loading', () => this.publish())
    contents.on('did-navigate', () => {
      void this.visualFeedback.refreshForCurrentUrl().catch(() => undefined)
      this.publish()
    })
    contents.on('did-navigate-in-page', () => {
      void this.visualFeedback.refreshForCurrentUrl().catch(() => undefined)
      this.publish()
    })
    contents.on('page-title-updated', () => this.publish())
    contents.on('devtools-opened', () => this.publish())
    contents.on('devtools-closed', () => this.publish())
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
