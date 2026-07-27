import { join } from 'node:path'
import { BrowserWindow, WebContentsView, app, session as electronSession } from 'electron'
import type { DownloadItem, Event as ElectronEvent, Session, WebContents } from 'electron'
import { integerTaskBrowserBounds } from './taskBrowserSurfaceManager.js'
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

const securedTaskBrowserSessions = new WeakSet<Session>()

class ElectronNativeTaskBrowserSurface implements NativeTaskBrowserSurface {
  private readonly view: WebContentsView
  private readonly browserSession: Session
  private readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private readonly childWindows = new Set<BrowserWindow>()
  private readonly activeDownloads = new Map<DownloadItem, () => void>()
  private attachedWindow: BrowserWindow | null = null
  private navigationError: TaskBrowserNavigationError | null = null
  private destroyed = false

  constructor(private readonly options: TaskBrowserSurfaceCreateOptions) {
    this.view = new WebContentsView({
      webPreferences: this.secureWebPreferences(),
    })
    this.browserSession = this.view.webContents.session
    if (!securedTaskBrowserSessions.has(this.browserSession)) {
      securedTaskBrowserSessions.add(this.browserSession)
      this.browserSession.setPermissionCheckHandler(() => false)
      this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    }
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
    this.cancelActiveDownloads()
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

  private configureSecurityPolicy(contents: WebContents): void {
    contents.on('will-navigate', (event, url) => {
      if (!allowedTopLevelUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowedTopLevelUrl(url)) event.preventDefault()
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
      devTools: !app.isPackaged,
    }
  }

  private registerChildWindow(window: BrowserWindow): void {
    if (this.destroyed || window.webContents.session !== this.view.webContents.session) {
      window.destroy()
      return
    }
    this.childWindows.add(window)
    window.on('closed', () => this.childWindows.delete(window))
    this.configureSecurityPolicy(window.webContents)
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
