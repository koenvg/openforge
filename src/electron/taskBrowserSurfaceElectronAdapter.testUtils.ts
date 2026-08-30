import { vi } from 'vitest'

export const electronFakes = (() => {
  type Listener = (...args: unknown[]) => void
  type PopupResponse = {
    action: 'allow' | 'deny'
    outlivesOpener?: boolean
    overrideBrowserWindowOptions?: { webPreferences?: { partition?: string }; [key: string]: unknown }
  }

  class FakeSession {
    readonly handlers = new Map<string, Listener[]>()
    readonly siteData = new Map<string, string>()
    clearStorageCalls = 0
    clearCacheCalls = 0

    setPermissionCheckHandler(handler: Listener): void {
      this.handlers.set('permission-check', [handler])
    }

    setPermissionRequestHandler(handler: Listener): void {
      this.handlers.set('permission-request', [handler])
    }

    on(event: string, handler: Listener): void {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
    }

    removeListener(event: string, handler: Listener): void {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter(candidate => candidate !== handler))
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    async clearStorageData(): Promise<void> {
      this.clearStorageCalls += 1
      this.siteData.clear()
    }

    async clearCache(): Promise<void> {
      this.clearCacheCalls += 1
    }
  }

  class FakeDownloadItem {
    readonly handlers = new Map<string, Listener[]>()
    readonly saveDialogOptions: unknown[] = []
    readonly savePaths: string[] = []
    saveDialogError: Error | null = null
    cancelCalls = 0

    constructor(readonly filename: string) {}

    once(event: string, handler: Listener): void {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }

    removeListener(event: string, handler: Listener): void {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter(candidate => candidate !== handler))
    }

    emit(event: string, ...args: unknown[]): void {
      const handlers = this.handlers.get(event) ?? []
      this.handlers.delete(event)
      for (const handler of handlers) handler(...args)
    }

    getFilename(): string { return this.filename }
    setSaveDialogOptions(options: unknown): void {
      if (this.saveDialogError) throw this.saveDialogError
      this.saveDialogOptions.push(options)
    }
    setSavePath(path: string): void { this.savePaths.push(path) }
    cancel(): void { this.cancelCalls += 1 }
  }

  class FakeWebContents {
    constructor(readonly session: FakeSession) {}
    readonly handlers = new Map<string, Listener[]>()
    readonly navigationHistory = {
      canGoBack: () => this.historyIndex > 0,
      canGoForward: () => this.historyIndex < this.historyLength - 1,
      goBack: () => { if (this.historyIndex > 0) this.historyIndex -= 1 },
      goForward: () => { if (this.historyIndex < this.historyLength - 1) this.historyIndex += 1 },
    }
    url = ''
    title = ''
    loading = false
    zoomFactor = 1
    historyIndex = 0
    historyLength = 1
    destroyed = false
    reloadCalls = 0
    stopCalls = 0
    openDevToolsCalls: unknown[] = []
    closeDevToolsCalls = 0
    devToolsOpened = false
    emitDevToolsEvents = true
    inspectElementCalls: Array<{ x: number; y: number }> = []
    devToolsInputEvents: unknown[] = []
    readonly devToolsWebContents = {
      sendInputEvent: (input: unknown) => { this.devToolsInputEvents.push(input) },
    }
    capturePageCalls: unknown[] = []
    captureSize = { width: 640, height: 480 }
    capturePng = Buffer.from('visible-viewport-png')
    executeJavaScriptCalls: string[] = []
    executeJavaScriptResult: unknown = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    executeJavaScriptResults: unknown[] = []
    backgroundThrottling: boolean[] = []
    windowOpenHandler: ((details: unknown) => unknown) | null = null
    loadError: Error | null = null

    on(event: string, handler: Listener): void {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
    }

    once(event: string, handler: Listener): void {
      const onceHandler: Listener = (...args) => {
        this.handlers.set(event, (this.handlers.get(event) ?? []).filter(candidate => candidate !== onceHandler))
        handler(...args)
      }
      this.on(event, onceHandler)
    }

    removeListener(event: string, handler: Listener): void {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter(candidate => candidate !== handler))
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    getURL(): string { return this.url }
    getTitle(): string { return this.title }
    getZoomFactor(): number { return this.zoomFactor }
    isLoading(): boolean { return this.loading }
    isDestroyed(): boolean { return this.destroyed }

    async loadURL(url: string): Promise<void> {
      if (this.loadError) throw this.loadError
      this.url = url
    }

    async capturePage(rect?: unknown): Promise<{ getSize(): { width: number; height: number }; toPNG(): Buffer }> {
      this.capturePageCalls.push(rect)
      return {
        getSize: () => ({ ...this.captureSize }),
        toPNG: () => Buffer.from(this.capturePng),
      }
    }

    async executeJavaScript(script: string): Promise<unknown> {
      this.executeJavaScriptCalls.push(script)
      return this.executeJavaScriptResults.length > 0
        ? this.executeJavaScriptResults.shift()
        : this.executeJavaScriptResult
    }

    reload(): void { this.reloadCalls += 1 }
    stop(): void { this.stopCalls += 1 }
    openDevTools(options?: unknown): void {
      this.openDevToolsCalls.push(options)
      if (this.emitDevToolsEvents) {
        this.devToolsOpened = true
        this.emit('devtools-opened')
      }
    }
    closeDevTools(): void {
      this.closeDevToolsCalls += 1
      this.devToolsOpened = false
      this.emit('devtools-closed')
    }
    isDevToolsOpened(): boolean { return this.devToolsOpened }
    inspectElement(x: number, y: number): void {
      this.inspectElementCalls.push({ x, y })
      if (!this.devToolsOpened) this.openDevTools()
    }
    setBackgroundThrottling(value: boolean): void { this.backgroundThrottling.push(value) }
    setWindowOpenHandler(handler: (details: unknown) => unknown): void { this.windowOpenHandler = handler }
    close(): void { this.destroyed = true }
  }

  class FakeWebContentsView {
    readonly webContents: FakeWebContents
    readonly bounds: unknown[] = []

    constructor(readonly options: unknown) {
      const partition = (options as { webPreferences?: { partition?: string } }).webPreferences?.partition ?? ''
      this.webContents = new FakeWebContents(sessionFor(partition))
      views.push(this)
    }

    setBounds(bounds: unknown): void { this.bounds.push(bounds) }
  }

  class FakeBrowserWindow {
    static fromId(id: number): FakeBrowserWindow | null {
      return windows.get(id) ?? null
    }

    readonly addedViews: FakeWebContentsView[] = []
    readonly removedViews: FakeWebContentsView[] = []
    readonly handlers = new Map<string, Listener[]>()
    readonly webContents: FakeWebContents
    readonly contentView = {
      addChildView: (view: FakeWebContentsView) => { this.addedViews.push(view) },
      removeChildView: (view: FakeWebContentsView) => { this.removedViews.push(view) },
    }
    destroyed = false

    constructor(readonly options: PopupResponse['overrideBrowserWindowOptions'] = {}) {
      const partition = options?.webPreferences?.partition ?? ''
      this.webContents = new FakeWebContents(sessionFor(partition))
    }

    on(event: string, handler: Listener): void {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    destroy(): void {
      if (this.destroyed) return
      this.destroyed = true
      this.webContents.close()
      this.emit('closed')
    }

    isDestroyed(): boolean { return this.destroyed }
  }

  type FakeMenuItem = { label?: string; click?: () => void }
  class FakeMenu {
    static buildFromTemplate(template: FakeMenuItem[]) {
      return {
        popup(options: unknown) { menuPopups.push({ template, options }) },
      }
    }
  }

  const views: FakeWebContentsView[] = []
  const sessions = new Map<string, FakeSession>()
  const windows = new Map<number, FakeBrowserWindow>()
  const childWindows: FakeBrowserWindow[] = []
  const menuPopups: Array<{ template: FakeMenuItem[]; options: unknown }> = []

  function sessionFor(partition: string): FakeSession {
    let browserSession = sessions.get(partition)
    if (!browserSession) {
      browserSession = new FakeSession()
      sessions.set(partition, browserSession)
    }
    return browserSession
  }

  return {
    FakeSession,
    FakeBrowserWindow,
    FakeDownloadItem,
    FakeWebContentsView,
    FakeMenu,
    menuPopups,
    views,
    childWindows,
    sessionFor,
    sessions,
    windows,
    openPopup(opener: FakeWebContents, url: string, features = '') {
      const response = opener.windowOpenHandler?.({
        url,
        features,
        frameName: 'task-browser-auth',
        disposition: 'new-window',
        referrer: { url: '', policy: 'default' },
      }) as PopupResponse | undefined
      if (!response || response.action !== 'allow') return { response, child: null }

      const child = new FakeBrowserWindow(response.overrideBrowserWindowOptions)
      childWindows.push(child)
      opener.emit('did-create-window', child, { url, options: response.overrideBrowserWindowOptions })
      return { response, child }
    },
    registerWindow(id: number) {
      const window = new FakeBrowserWindow()
      windows.set(id, window)
      return window
    },
    reset() {
      views.length = 0
      childWindows.length = 0
      menuPopups.length = 0
      sessions.clear()
      windows.clear()
    },
  }
})()

vi.doMock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => name === 'downloads' ? '/downloads' : '/',
  },
  BrowserWindow: electronFakes.FakeBrowserWindow,
  Menu: electronFakes.FakeMenu,
  WebContentsView: electronFakes.FakeWebContentsView,
  session: {
    fromPartition: electronFakes.sessionFor,
  },
}))

export function preventableEvent() {
  let prevented = false
  return {
    preventDefault() { prevented = true },
    get prevented() { return prevented },
  }
}
