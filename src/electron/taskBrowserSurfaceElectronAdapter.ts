import { join } from 'node:path'
import { BrowserWindow, Menu, WebContentsView, app, session as electronSession } from 'electron'
import type { DownloadItem, Event as ElectronEvent, Session, WebContents } from 'electron'
import { TaskBrowserSurfaceError, integerTaskBrowserBounds } from './taskBrowserSurfaceManager.js'
import {
  buildTaskBrowserVisualFeedbackAnnotationsScript,
  buildTaskBrowserVisualFeedbackDismissScript,
  runTaskBrowserVisualFeedbackOverlay,
} from './taskBrowserVisualFeedbackOverlay.js'
import type { TaskBrowserVisualFeedbackAnnotation } from './taskBrowserVisualFeedbackOverlay.js'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserDevToolsPanel,
  TaskBrowserNavigationError,
  TaskBrowserSurfaceCreateOptions,
  TaskBrowserSurfaceVisualFeedback,
} from './taskBrowserSurfaceManager.js'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'

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

interface TaskBrowserKeyboardInput {
  type: string
  key: string
  control?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

type TaskBrowserDevToolsShortcut = 'toggle' | TaskBrowserDevToolsPanel

const DEVTOOLS_OPEN_TIMEOUT_MS = 2_000

function taskBrowserDevToolsShortcut(
  input: TaskBrowserKeyboardInput,
  platform: NodeJS.Platform = process.platform,
): TaskBrowserDevToolsShortcut | null {
  if (input.type !== 'keyDown') return null
  const key = input.key.toLowerCase()
  if (key === 'f12') return 'toggle'
  const modified = platform === 'darwin'
    ? input.meta === true && input.alt === true && input.control !== true && input.shift !== true
    : input.control === true && input.shift === true && input.meta !== true && input.alt !== true
  if (!modified) return null
  if (key === 'i') return 'toggle'
  if (key === 'c') return 'elements'
  return key === 'j' ? 'console' : null
}

function devToolsPanelInput(panel: TaskBrowserDevToolsPanel) {
  const modifiers: Array<'control' | 'shift' | 'alt' | 'meta'> = process.platform === 'darwin'
    ? ['meta', 'alt']
    : ['control', 'shift']
  return {
    type: 'keyDown' as const,
    keyCode: panel === 'elements' ? 'C' : 'J',
    modifiers,
  }
}

async function openTaskBrowserDevTools(
  contents: WebContents,
  panel?: TaskBrowserDevToolsPanel,
): Promise<void> {
  if (!contents.isDevToolsOpened()) {
    await new Promise<void>((resolve, reject) => {
      const opened = () => {
        clearTimeout(timeout)
        contents.removeListener('devtools-opened', opened)
        resolve()
      }
      const timeout = setTimeout(() => {
        contents.removeListener('devtools-opened', opened)
        reject(new TaskBrowserSurfaceError(
          'HOST_UNAVAILABLE',
          'Chromium Developer Tools did not open',
        ))
      }, DEVTOOLS_OPEN_TIMEOUT_MS)
      contents.on('devtools-opened', opened)
      try {
        contents.openDevTools()
        if (contents.isDevToolsOpened()) opened()
      } catch (error) {
        clearTimeout(timeout)
        contents.removeListener('devtools-opened', opened)
        reject(error)
      }
    })
  }
  if (panel) contents.devToolsWebContents?.sendInputEvent(devToolsPanelInput(panel))
}

const INVALID_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"|?*]/g
const RESERVED_WINDOWS_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const MAX_SUGGESTED_FILENAME_BYTES = 200
const MAX_SUGGESTED_FILENAME_CODE_UNITS = 200

function takeFilenamePrefix(value: string, maxBytes: number, maxCodeUnits: number): string {
  let result = ''
  let byteLength = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (byteLength + characterBytes > maxBytes || result.length + character.length > maxCodeUnits) break
    result += character
    byteLength += characterBytes
  }
  return result
}

function truncateSuggestedFilename(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_SUGGESTED_FILENAME_BYTES && value.length <= MAX_SUGGESTED_FILENAME_CODE_UNITS) {
    return value
  }

  const extensionStart = value.lastIndexOf('.')
  const candidateExtension = extensionStart > 0 ? value.slice(extensionStart) : ''
  const extension = candidateExtension.length <= 32 && Buffer.byteLength(candidateExtension, 'utf8') <= 64
    ? candidateExtension
    : ''
  const basename = extension ? value.slice(0, extensionStart) : value
  const prefix = takeFilenamePrefix(
    basename,
    MAX_SUGGESTED_FILENAME_BYTES - Buffer.byteLength(extension, 'utf8'),
    MAX_SUGGESTED_FILENAME_CODE_UNITS - extension.length,
  )
  return `${prefix}${extension}`
}

export function sanitizeTaskBrowserDownloadFilename(suggestedFilename: string): string {
  const leaf = suggestedFilename.normalize('NFKC').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  let sanitized = leaf
    .replace(INVALID_FILENAME_CHARACTERS, '_')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!sanitized || sanitized === '.' || sanitized === '..') return 'download'
  if (RESERVED_WINDOWS_FILENAME.test(sanitized)) sanitized = `_${sanitized}`

  sanitized = truncateSuggestedFilename(sanitized).replace(/[. ]+$/g, '')
  return sanitized || 'download'
}

const DENY_TASK_BROWSER_PERMISSIONS: TaskBrowserPermissionSessionHandler = {
  check: () => false,
  request: async () => false,
}

type PermissionOwner = {
  windowId: number
  handler: TaskBrowserPermissionSessionHandler
}

class ElectronTaskBrowserPermissionRouter {
  private readonly owners = new Map<WebContents, PermissionOwner>()

  constructor(browserSession: Session) {
    browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!webContents) return false
      const owner = this.owners.get(webContents)
      if (!owner) return false
      try {
        return owner.handler.check({ permission, requestingOrigin, details })
      } catch {
        return false
      }
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const owner = this.owners.get(webContents)
      if (!owner) {
        callback(false)
        return
      }
      try {
        void owner.handler.request({ windowId: owner.windowId, permission, details })
          .then(decision => callback(decision === true), () => callback(false))
      } catch {
        callback(false)
      }
    })
  }

  register(webContents: WebContents, owner: PermissionOwner): void {
    this.owners.set(webContents, owner)
  }

  unregister(webContents: WebContents): void {
    this.owners.delete(webContents)
  }
}

const taskBrowserPermissionRouters = new WeakMap<Session, ElectronTaskBrowserPermissionRouter>()

function permissionRouterFor(browserSession: Session): ElectronTaskBrowserPermissionRouter {
  let router = taskBrowserPermissionRouters.get(browserSession)
  if (!router) {
    router = new ElectronTaskBrowserPermissionRouter(browserSession)
    taskBrowserPermissionRouters.set(browserSession, router)
  }
  return router
}

type StoredVisualFeedback = TaskBrowserVisualFeedbackAnnotation & {
  region: TaskBrowserSurfaceVisualFeedback['region']
}

class ElectronNativeTaskBrowserSurface implements NativeTaskBrowserSurface {
  private readonly view: WebContentsView
  private readonly browserSession: Session
  private readonly permissionRouter: ElectronTaskBrowserPermissionRouter
  private readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private readonly childWindows = new Set<BrowserWindow>()
  private readonly activeDownloads = new Map<DownloadItem, () => void>()
  private readonly feedbackAnnotationsByUrl = new Map<string, StoredVisualFeedback[]>()
  private attachedWindow: BrowserWindow | null = null
  private navigationError: TaskBrowserNavigationError | null = null
  private cancelSelection: (() => void) | null = null
  private destroyed = false

  constructor(private readonly options: TaskBrowserSurfaceCreateOptions) {
    this.view = new WebContentsView({
      webPreferences: this.secureWebPreferences(),
    })
    this.browserSession = this.view.webContents.session
    this.permissionRouter = permissionRouterFor(this.browserSession)
    this.permissionRouter.register(this.view.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    this.browserSession.on('will-download', this.handleWillDownload)
    this.configureSecurityPolicy(this.view.webContents)
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

  async loadURL(url: string): Promise<void> {
    this.navigationError = null
    this.hideVisualFeedbackForNavigation()
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
    this.destroyChildWindows()
    this.browserSession.removeListener('will-download', this.handleWillDownload)
    this.permissionRouter.unregister(this.view.webContents)
    this.cancelActiveDownloads()
    this.listeners.clear()
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async goBack(): Promise<void> {
    this.hideVisualFeedbackForNavigation()
    if (this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    this.hideVisualFeedbackForNavigation()
    if (this.view.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward()
  }

  async reload(): Promise<void> {
    this.navigationError = null
    this.hideVisualFeedbackForNavigation()
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
    await this.cancelVisibleRegionSelection()
    await openTaskBrowserDevTools(this.view.webContents, panel)
  }

  async closeDevTools(): Promise<void> {
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    this.view.webContents.closeDevTools()
  }

  async selectVisibleRegion() {
    await this.cancelVisibleRegionSelection()
    if (this.destroyed) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (this.attachedWindow === null) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before selecting feedback')
    }
    let requestCancel: (() => void) | null = null
    try {
      const pageUrl = this.view.webContents.getURL()
      const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      const nextAnnotationNumber = Array.from(this.feedbackAnnotationsByUrl.values())
        .flat()
        .reduce((maximum, annotation) => Math.max(maximum, annotation.number), 0) + 1
      const cancelled = new Promise<null>(resolve => {
        requestCancel = () => resolve(null)
      })
      this.cancelSelection = requestCancel
      const selection = runTaskBrowserVisualFeedbackOverlay(
        (script, userGesture) => this.view.webContents.executeJavaScript(script, userGesture),
        { savedAnnotations, nextAnnotationNumber },
      )
      const result = await Promise.race([selection, cancelled])
      if (result === null) return null
      const pageAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      pageAnnotations.push({
        ...result.annotation,
        region: { ...result.region },
      })
      this.feedbackAnnotationsByUrl.set(pageUrl, pageAnnotations)
      return {
        region: result.region,
        comment: result.comment,
        annotationNumber: result.annotation.number,
      }
    } catch (error) {
      if (error instanceof TaskBrowserSurfaceError) throw error
      throw new TaskBrowserSurfaceError(
        'CAPTURE_FAILED',
        `Could not select a region on the live Task Browser page: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (requestCancel !== null && this.cancelSelection === requestCancel) this.cancelSelection = null
    }
  }

  async cancelVisibleRegionSelection(): Promise<void> {
    const cancel = this.cancelSelection
    cancel?.()
    this.cancelSelection = null
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents
      .executeJavaScript(buildTaskBrowserVisualFeedbackDismissScript(), true)
      .catch(() => undefined)
  }

  async clearVisualFeedback(): Promise<void> {
    await this.cancelVisibleRegionSelection()
    this.feedbackAnnotationsByUrl.clear()
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents.executeJavaScript(`(() => {
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  async replaceVisualFeedback(feedback: readonly TaskBrowserSurfaceVisualFeedback[]): Promise<void> {
    await this.cancelVisibleRegionSelection()
    if (this.destroyed || this.view.webContents.isDestroyed()) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }

    const current = await this.view.webContents.executeJavaScript(`({
      url: location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    })`, true) as { url: string; width: number; height: number; scrollX: number; scrollY: number }
    const existing = new Map(Array.from(this.feedbackAnnotationsByUrl.values())
      .flat()
      .map(annotation => [annotation.number, annotation]))
    const replacement = new Map<string, StoredVisualFeedback[]>()

    for (const marker of feedback) {
      const previous = existing.get(marker.annotationNumber)
      const viewportWidth = previous === undefined ? current.width : previous.width / previous.region.width
      const viewportHeight = previous === undefined ? current.height : previous.height / previous.region.height
      const scrollX = previous === undefined ? (marker.url === current.url ? current.scrollX : 0) : previous.x - previous.region.x * viewportWidth
      const scrollY = previous === undefined ? (marker.url === current.url ? current.scrollY : 0) : previous.y - previous.region.y * viewportHeight
      const annotations = replacement.get(marker.url) ?? []
      annotations.push({
        number: marker.annotationNumber,
        comment: marker.comment,
        region: { ...marker.region },
        x: scrollX + marker.region.x * viewportWidth,
        y: scrollY + marker.region.y * viewportHeight,
        width: marker.region.width * viewportWidth,
        height: marker.region.height * viewportHeight,
      })
      replacement.set(marker.url, annotations)
    }

    this.feedbackAnnotationsByUrl.clear()
    for (const [url, annotations] of replacement) this.feedbackAnnotationsByUrl.set(url, annotations)
    await this.refreshVisualFeedbackForCurrentUrl()
  }

  async captureVisibleViewport() {
    if (this.destroyed) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (this.attachedWindow === null) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before it can be captured')
    }

    await this.setVisualFeedbackVisibility('hidden')
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
      await this.setVisualFeedbackVisibility('')
    }
  }

  private async setVisualFeedbackVisibility(visibility: '' | 'hidden'): Promise<void> {
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents.executeJavaScript(`(() => {
      const annotations = document.getElementById('__openforge_visual_feedback_annotations__');
      if (annotations) annotations.style.visibility = ${JSON.stringify(visibility)};
      if (${visibility === 'hidden'}) return new Promise(resolve => requestAnimationFrame(() => resolve()));
    })()`, true).catch(() => undefined)
  }

  private hideVisualFeedbackForNavigation(): void {
    this.cancelSelection?.()
    this.cancelSelection = null
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    void this.view.webContents.executeJavaScript(`${buildTaskBrowserVisualFeedbackDismissScript()};
    (() => {
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  private async refreshVisualFeedbackForCurrentUrl(): Promise<void> {
    const contents = this.view.webContents
    if (this.destroyed || contents.isDestroyed()) return
    const pageUrl = contents.getURL()
    const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
    await contents.executeJavaScript(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations,
        expectedUrl: pageUrl,
      })}
    })()`, true)
  }

  private ownsWebContents(webContents: WebContents): boolean {
    return webContents === this.view.webContents
      || Array.from(this.childWindows).some(window => !window.isDestroyed() && window.webContents === webContents)
  }

  private readonly handleWillDownload = (_event: ElectronEvent, item: DownloadItem, webContents: WebContents): void => {
    if (!this.ownsWebContents(webContents) || this.destroyed) return

    const window = BrowserWindow.fromId(this.options.windowId)
    if (!window || window.isDestroyed()) {
      item.cancel()
      return
    }

    const release = () => this.activeDownloads.delete(item)
    this.activeDownloads.set(item, release)
    item.once('done', release)
    try {
      item.setSaveDialogOptions({
        title: 'Save download',
        defaultPath: join(app.getPath('downloads'), sanitizeTaskBrowserDownloadFilename(item.getFilename())),
        buttonLabel: 'Save',
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      })
    } catch {
      item.removeListener('done', release)
      release()
      item.cancel()
    }
  }

  private cancelActiveDownloads(): void {
    for (const [item, release] of this.activeDownloads) {
      item.removeListener('done', release)
      try {
        item.cancel()
      } catch {
        // Continue releasing the remaining host-owned downloads.
      }
    }
    this.activeDownloads.clear()
  }

  private runAfterCancelingSelection(action: () => void): void {
    void this.cancelVisibleRegionSelection().then(action)
  }

  private configureSecurityPolicy(contents: WebContents, ownerWindow: BrowserWindow | null = null): void {
    contents.on('before-input-event', (event, input) => {
      const shortcut = taskBrowserDevToolsShortcut(input)
      if (shortcut === null) return
      event.preventDefault()
      if (shortcut !== 'toggle') {
        this.runAfterCancelingSelection(() => {
          void openTaskBrowserDevTools(contents, shortcut)
        })
      } else if (contents.isDevToolsOpened()) {
        contents.closeDevTools()
      } else {
        this.runAfterCancelingSelection(() => {
          void openTaskBrowserDevTools(contents)
        })
      }
    })
    contents.on('context-menu', (_event, params) => {
      const menu = Menu.buildFromTemplate([{
        label: 'Inspect element',
        click: () => this.runAfterCancelingSelection(
          () => contents.inspectElement(params.x, params.y),
        ),
      }])
      const window = ownerWindow ?? this.attachedWindow
      menu.popup(window && !window.isDestroyed() ? { window } : {})
    })
    contents.on('will-navigate', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.view.webContents) this.hideVisualFeedbackForNavigation()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.view.webContents) this.hideVisualFeedbackForNavigation()
    })
    contents.setWindowOpenHandler(({ url, features }) => {
      if (!this.options.popupPolicy.isAllowed({ url, features })) return { action: 'deny' }
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          ...(this.attachedWindow && !this.attachedWindow.isDestroyed()
            ? { parent: this.attachedWindow }
            : {}),
          autoHideMenuBar: true,
          webPreferences: this.secureWebPreferences(),
        },
      }
    })
    contents.on('did-create-window', window => this.registerChildWindow(window))
  }

  private secureWebPreferences() {
    return {
      ...this.options.webPreferences,
      partition: this.options.partition,
      devTools: true,
    }
  }

  private registerChildWindow(window: BrowserWindow): void {
    if (this.destroyed || window.webContents.session !== this.view.webContents.session) {
      window.destroy()
      return
    }
    this.childWindows.add(window)
    this.permissionRouter.register(window.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    window.on('closed', () => {
      this.childWindows.delete(window)
      this.permissionRouter.unregister(window.webContents)
    })
    this.configureSecurityPolicy(window.webContents, window)
  }

  private destroyChildWindows(): void {
    for (const childWindow of Array.from(this.childWindows)) {
      if (!childWindow.isDestroyed()) childWindow.destroy()
    }
    this.childWindows.clear()
  }

  private configureStatePublication(contents: WebContents): void {
    contents.on('did-start-loading', () => {
      this.navigationError = null
      this.hideVisualFeedbackForNavigation()
      this.publish()
    })
    contents.on('did-stop-loading', () => this.publish())
    contents.on('did-navigate', () => {
      void this.refreshVisualFeedbackForCurrentUrl().catch(() => undefined)
      this.publish()
    })
    contents.on('did-navigate-in-page', () => {
      void this.refreshVisualFeedbackForCurrentUrl().catch(() => undefined)
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
