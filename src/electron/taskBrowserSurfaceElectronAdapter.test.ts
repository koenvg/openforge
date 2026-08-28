import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import type { TaskBrowserNativeState } from './taskBrowserSurfaceManager'

const electronFakes = vi.hoisted(() => {
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
})

vi.mock('electron', () => ({
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

import {
  ElectronTaskBrowserSurfaceFactory,
  electronRendererZoomFactor,
  sanitizeTaskBrowserDownloadFilename,
} from './taskBrowserSurfaceElectronAdapter'
function preventableEvent() {
  let prevented = false
  return {
    preventDefault() { prevented = true },
    get prevented() { return prevented },
  }
}

type PlatformDevToolsShortcut = 'toggle' | 'elements' | 'console'

const platformDevToolsModifiers = (shortcut: PlatformDevToolsShortcut = 'toggle') => process.platform === 'darwin'
  ? shortcut === 'elements'
    ? { meta: true, shift: true }
    : { meta: true, alt: true }
  : { control: true, shift: true }

const platformDevToolsInputModifiers = (shortcut: PlatformDevToolsShortcut = 'toggle') => process.platform === 'darwin'
  ? shortcut === 'elements'
    ? ['meta', 'shift']
    : ['meta', 'alt']
  : ['control', 'shift']

describe('Electron Task Browser Surface navigation adapter', () => {
  beforeEach(() => electronFakes.reset())

  it('attaches, detaches, throttles, and destroys the native live page', () => {
    const window = electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]

    expect(view.webContents.backgroundThrottling).toEqual([true])
    surface.attach(10, { x: 10.4, y: 20.6, width: 300.2, height: 199.8 })
    expect(window.addedViews).toEqual([view])
    expect(view.bounds).toEqual([{ x: 10, y: 21, width: 301, height: 199 }])
    surface.attach(10, { x: 0.5, y: 0.5, width: 799.5, height: 599.5 })
    expect(view.bounds.at(-1)).toEqual({ x: 1, y: 1, width: 799, height: 599 })
    expect(view.webContents.backgroundThrottling.at(-1)).toBe(false)

    surface.attach(10, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(window.removedViews).toEqual([view])
    expect(view.webContents.backgroundThrottling.at(-1)).toBe(true)

    surface.detach()
    expect(window.removedViews).toEqual([view])
    expect(view.webContents.backgroundThrottling.at(-1)).toBe(true)

    surface.destroy()
    expect(view.webContents.destroyed).toBe(true)
  })

  it('opens packaged Task Browser DevTools and publishes their live surface state', async () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const states: TaskBrowserNativeState[] = []
    surface.onStateChanged(state => states.push(state))

    expect((view.options as { webPreferences: { devTools: boolean } }).webPreferences.devTools).toBe(true)
    expect(surface.getState().devToolsOpen).toBe(false)

    await surface.openDevTools()
    expect(view.webContents.openDevToolsCalls).toEqual([undefined])
    expect(surface.getState().devToolsOpen).toBe(true)
    expect(states.at(-1)?.devToolsOpen).toBe(true)

    surface.detach()
    expect(surface.getState().devToolsOpen).toBe(true)

    await surface.closeDevTools()
    expect(view.webContents.closeDevToolsCalls).toBe(1)
    expect(surface.getState().devToolsOpen).toBe(false)
    expect(states.at(-1)?.devToolsOpen).toBe(false)
  })

  it('rejects when Chromium does not open Task Browser DevTools', async () => {
    vi.useFakeTimers()
    try {
      const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
        windowId: 10,
        partition: 'persist:test-browser-devtools-failure',
        webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
        popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
      })
      const contents = electronFakes.views[0].webContents
      contents.emitDevToolsEvents = false

      const opening = surface.openDevTools()
      const rejection = expect(opening).rejects.toMatchObject({
        code: 'HOST_UNAVAILABLE',
        message: 'Chromium Developer Tools did not open',
      })
      await vi.advanceTimersByTimeAsync(2_000)
      await rejection
      expect(surface.getState().devToolsOpen).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels active visual-feedback selection before opening Task Browser DevTools', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-selection',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const contents = electronFakes.views[0].webContents
    let finishSelection!: (value: null) => void
    const pendingSelection = new Promise<null>(resolve => { finishSelection = resolve })
    contents.executeJavaScriptResults = [undefined, pendingSelection, undefined]
    let selectionFinished = false
    const selection = surface.selectVisibleRegion().then(result => {
      selectionFinished = true
      return result
    })
    while (contents.executeJavaScriptCalls.length < 2) await Promise.resolve()

    await surface.openDevTools()
    await Promise.resolve()

    expect(selectionFinished).toBe(true)
    await expect(selection).resolves.toBeNull()
    expect(contents.executeJavaScriptCalls.at(-1)).toContain('__openforge_visual_feedback_selector__')
    expect(contents.openDevToolsCalls).toEqual([undefined])
    finishSelection(null)
  })

  it('toggles Task Browser DevTools with standard shortcuts in the page and focused popups', async () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-shortcuts',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents

    const openEvent = preventableEvent()
    contents.emit('before-input-event', openEvent, { type: 'keyDown', key: 'F12' })
    expect(openEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(contents.openDevToolsCalls).toEqual([undefined]))

    const closeEvent = preventableEvent()
    contents.emit('before-input-event', closeEvent, {
      type: 'keyDown',
      key: 'i',
      ...platformDevToolsModifiers(),
    })
    expect(closeEvent.prevented).toBe(true)
    expect(contents.closeDevToolsCalls).toBe(1)

    const ignoredEvent = preventableEvent()
    contents.emit('before-input-event', ignoredEvent, { type: 'keyDown', key: 'r', control: true })
    expect(ignoredEvent.prevented).toBe(false)

    const wrongPlatformEvent = preventableEvent()
    contents.emit('before-input-event', wrongPlatformEvent, {
      type: 'keyDown',
      key: 'i',
      ...(process.platform === 'darwin'
        ? { control: true, shift: true }
        : { meta: true, alt: true }),
    })
    expect(wrongPlatformEvent.prevented).toBe(false)

    const popup = electronFakes.openPopup(contents, 'https://popup.example').child!
    const popupEvent = preventableEvent()
    popup.webContents.emit('before-input-event', popupEvent, {
      type: 'keyDown',
      key: 'i',
      ...platformDevToolsModifiers(),
    })
    expect(popupEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(popup.webContents.openDevToolsCalls).toEqual([undefined]))

    surface.destroy()
  })

  it('forwards Elements and Console shortcuts to Chromium DevTools', async () => {
    new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-panels',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents
    const elementsInput = { type: 'keyDown', key: 'c', ...platformDevToolsModifiers('elements') }
    const elementsEvent = preventableEvent()

    contents.emit('before-input-event', elementsEvent, elementsInput)
    expect(elementsEvent.prevented).toBe(true)
    await vi.waitFor(() => expect(contents.openDevToolsCalls).toEqual([undefined]))
    expect(contents.devToolsInputEvents).toEqual([
      { type: 'keyDown', keyCode: 'C', modifiers: platformDevToolsInputModifiers('elements') },
    ])

    const consoleInput = { type: 'keyDown', key: 'j', ...platformDevToolsModifiers() }
    const consoleEvent = preventableEvent()
    contents.emit('before-input-event', consoleEvent, consoleInput)
    expect(consoleEvent.prevented).toBe(true)
    expect(contents.openDevToolsCalls).toHaveLength(1)
    await vi.waitFor(() => expect(contents.devToolsInputEvents).toEqual([
      { type: 'keyDown', keyCode: 'C', modifiers: platformDevToolsInputModifiers('elements') },
      { type: 'keyDown', keyCode: 'J', modifiers: platformDevToolsInputModifiers() },
    ]))
  })

  it('offers Inspect element for the page and host-owned popups', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-devtools-inspect',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const contents = electronFakes.views[0].webContents

    contents.emit('context-menu', {}, { x: 24, y: 36 })
    expect(electronFakes.menuPopups).toHaveLength(1)
    expect(electronFakes.menuPopups[0].template.map(item => item.label)).toEqual(['Inspect element'])
    electronFakes.menuPopups[0].template[0].click?.()
    await vi.waitFor(() => expect(contents.inspectElementCalls).toEqual([{ x: 24, y: 36 }]))

    const popup = electronFakes.openPopup(contents, 'https://popup.example').child!
    popup.webContents.emit('context-menu', {}, { x: 8, y: 12 })
    electronFakes.menuPopups[1].template[0].click?.()
    await vi.waitFor(() => expect(popup.webContents.inspectElementCalls).toEqual([{ x: 8, y: 12 }]))
  })

  it('collects a region on the live page while preserving native page scrolling', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-live-selection',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })

    electronFakes.views[0].webContents.executeJavaScriptResult = {
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'Navigation spacing is unclear',
      annotation: { number: 1, x: 64, y: 96, width: 192, height: 192 },
    }

    await expect(surface.selectVisibleRegion()).resolves.toEqual({
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'Navigation spacing is unclear',
      annotationNumber: 1,
    })

    const script = electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1) ?? ''
    expect(script).toContain('Feedback comment')
    expect(script).toContain('elementsFromPoint')
    expect(script).toContain('__openforge_visual_feedback_annotations__')
    expect(script).toContain('savedAnnotations.forEach(renderAnnotation)')
    expect(script).toContain('annotationsRoot.dataset.pageUrl = location.href')
    expect(script).toContain("annotation.style.cssText = 'position:absolute")
    expect(script).toContain('pointer-events:none')
    expect(script).not.toContain('outerHTML')
    expect(script).not.toContain('querySelector')

    await surface.loadURL('https://second.example/')
    electronFakes.views[0].webContents.executeJavaScriptResult = {
      region: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
      comment: 'Second page feedback',
      annotation: { number: 2, x: 128, y: 144, width: 128, height: 96 },
    }
    await surface.selectVisibleRegion()
    expect(electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1)).toContain('const nextAnnotationNumber = 2')

    await surface.clearVisualFeedback()
    expect(electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1)).toContain("document.getElementById('__openforge_visual_feedback_annotations__')?.remove()")
  })

  it('replaces corrected normalized markers on the live page without detaching it', async () => {
    const window = electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-corrected-feedback',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })
    const contents = electronFakes.views[0].webContents
    await surface.loadURL('https://example.com/')
    contents.executeJavaScriptResult = {
      url: 'https://example.com/',
      width: 640,
      height: 480,
      scrollX: 0,
      scrollY: 120,
    }

    await surface.replaceVisualFeedback([{
      annotationNumber: 1,
      url: 'https://example.com/',
      region: { x: 0.25, y: 0.1, width: 0.5, height: 0.2 },
      comment: 'Corrected live marker',
    }])

    const script = contents.executeJavaScriptCalls.at(-1) ?? ''
    expect(script).toContain('Corrected live marker')
    expect(script).toContain('"region":{"x":0.25,"y":0.1,"width":0.5,"height":0.2}')
    expect(script).toContain('"x":160')
    expect(script).toContain('"y":168')
    expect(window.removedViews).toEqual([])
    expect(contents.capturePageCalls).toEqual([])
  })
  it('hides stale annotations during navigation and restores the destination URL annotations automatically', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-navigation-feedback',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })
    const contents = electronFakes.views[0].webContents

    await surface.loadURL('https://first.example/')
    contents.executeJavaScriptResult = {
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'First page feedback',
      annotation: { number: 1, x: 64, y: 96, width: 192, height: 192 },
    }
    await surface.selectVisibleRegion()

    await surface.loadURL('https://second.example/')
    contents.executeJavaScriptResult = {
      region: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
      comment: 'Second page feedback',
      annotation: { number: 2, x: 128, y: 144, width: 128, height: 96 },
    }
    await surface.selectVisibleRegion()
    contents.executeJavaScriptCalls.length = 0

    contents.emit('will-navigate', { preventDefault: vi.fn() }, 'https://first.example/')
    expect(contents.executeJavaScriptCalls.at(-1)).toContain("document.getElementById('__openforge_visual_feedback_annotations__')?.remove()")

    contents.url = 'https://first.example/'
    contents.emit('did-navigate')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.at(-1)).toContain('First page feedback'))
    expect(contents.executeJavaScriptCalls.at(-1)).not.toContain('Second page feedback')

    contents.url = 'https://second.example/'
    contents.emit('did-navigate-in-page')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.at(-1)).toContain('Second page feedback'))
    expect(contents.executeJavaScriptCalls.at(-1)).not.toContain('First page feedback')

    contents.executeJavaScriptCalls.length = 0
    contents.historyIndex = 1
    contents.historyLength = 2
    await surface.goBack()
    expect(contents.executeJavaScriptCalls.at(-1)).toContain("document.getElementById('__openforge_visual_feedback_annotations__')?.remove()")

    contents.url = 'https://first.example/'
    contents.emit('did-navigate')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.at(-1)).toContain('First page feedback'))
  })

  it('captures only the current visible viewport as PNG with native dimensions', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-capture',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })

    const capture = await surface.captureVisibleViewport()

    const contents = electronFakes.views[0].webContents
    expect(contents.capturePageCalls).toEqual([undefined])
    expect(contents.executeJavaScriptCalls).toHaveLength(2)
    expect(contents.executeJavaScriptCalls[0]).toContain("annotations.style.visibility = \"hidden\"")
    expect(contents.executeJavaScriptCalls[1]).toContain("annotations.style.visibility = \"\"")
    expect(capture).toEqual({
      png: Buffer.from('visible-viewport-png'),
      width: 640,
      height: 480,
    })
  })


  it('reports the renderer zoom factor of the owning window and falls back to unzoomed', () => {
    const window = electronFakes.registerWindow(10)

    expect(electronRendererZoomFactor(10)).toBe(1)
    window.webContents.zoomFactor = 1.2
    expect(electronRendererZoomFactor(10)).toBe(1.2)

    expect(electronRendererZoomFactor(99)).toBe(1)
    window.destroy()
    expect(electronRendererZoomFactor(10)).toBe(1)
  })

  it('reuses persistent Electron sessions across surfaces, destruction, and factory lifetimes', async () => {
    const partition = 'persist:openforge-task-browser-shared'
    const factory = new ElectronTaskBrowserSurfaceFactory()
    const first = factory.createSurface({
      windowId: 10,
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition: 'persist:openforge-task-browser-isolated',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })

    const sharedSession = electronFakes.views[0].webContents.session
    sharedSession.siteData.set('cookie', 'signed-in')
    expect(electronFakes.views[1].webContents.session).toBe(sharedSession)
    expect(electronFakes.views[2].webContents.session).not.toBe(sharedSession)

    first.destroy()
    new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition,
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    expect(electronFakes.views[3].webContents.session).toBe(sharedSession)
    expect(electronFakes.views[3].webContents.session.siteData.get('cookie')).toBe('signed-in')

    await factory.clearSession(partition)
    expect(sharedSession.siteData.size).toBe(0)
    expect(sharedSession.clearStorageCalls).toBe(1)
    expect(sharedSession.clearCacheCalls).toBe(1)
  })
  it('keeps secure browser preferences fixed and only permits HTTP(S) top-level destinations', () => {
    const factory = new ElectronTaskBrowserSurfaceFactory()
    factory.createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const contents = view.webContents

    expect(view.options).toEqual({
      webPreferences: {
        ...SECURE_TASK_BROWSER_WEB_PREFERENCES,
        partition: 'persist:test-browser',
        devTools: true,
      },
    })

    for (const url of ['https://example.com', 'http://localhost:3000/path']) {
      const event = preventableEvent()
      contents.emit('will-navigate', event, url)
      expect(event.prevented).toBe(false)
    }

    for (const url of [
      'about:blank',
      'file:///tmp/secret',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'plugin://browser/page',
      'openforge://internal',
      'mailto:user@example.com',
      'malformed',
    ]) {
      const event = preventableEvent()
      contents.emit('will-navigate', event, url)
      expect(event.prevented, url).toBe(true)
    }

    const unsafeRedirect = preventableEvent()
    contents.emit('will-redirect', unsafeRedirect, 'file:///tmp/redirected')
    expect(unsafeRedirect.prevented).toBe(true)
    expect(electronFakes.openPopup(contents, 'https://popup.example').response?.action).toBe('allow')
    expect(electronFakes.openPopup(contents, 'file:///tmp/popup').response).toEqual({ action: 'deny' })
    expect(electronFakes.openPopup(contents, 'https://popup.example', 'sandbox=no').response)
      .toEqual({ action: 'deny' })
  })

  it('creates host-owned HTTP(S) children with the parent session and complete browser policy', () => {
    const window = electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-popup',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 800, height: 600 })
    const parentContents = electronFakes.views[0].webContents

    const { response, child } = electronFakes.openPopup(
      parentContents,
      'https://auth.example/authorize',
      'width=640,height=720',
    )

    expect(response).toMatchObject({
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        parent: window,
        webPreferences: {
          ...SECURE_TASK_BROWSER_WEB_PREFERENCES,
          partition: 'persist:test-browser-popup',
          devTools: true,
        },
      },
    })
    expect(child).not.toBeNull()
    expect(child!.webContents.session).toBe(parentContents.session)
    expect(child!.webContents.session.handlers.get('permission-request'))
      .toBe(parentContents.session.handlers.get('permission-request'))
    expect(child!.webContents.session.handlers.get('will-download'))
      .toBe(parentContents.session.handlers.get('will-download'))

    const childDownload = new electronFakes.FakeDownloadItem('oauth-token.json')
    parentContents.session.emit('will-download', {}, childDownload, child!.webContents)
    expect(childDownload.saveDialogOptions).toEqual([expect.objectContaining({
      defaultPath: '/downloads/oauth-token.json',
    })])
    childDownload.emit('done', {}, 'completed')

    const unsafeNavigation = preventableEvent()
    child!.webContents.emit('will-navigate', unsafeNavigation, 'file:///tmp/secret')
    expect(unsafeNavigation.prevented).toBe(true)
    expect(electronFakes.openPopup(child!.webContents, 'https://nested.example').response?.action).toBe('allow')
    expect(electronFakes.openPopup(child!.webContents, 'https://nested.example', 'nodeIntegration=yes').response)
      .toEqual({ action: 'deny' })
  })

  it('supports a deterministic OAuth-style handoff through one shared Plugin Browser Session', () => {
    const factory = new ElectronTaskBrowserSurfaceFactory()
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-a',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-a',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    factory.createSurface({
      windowId: 10,
      partition: 'persist:task-b',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const firstParent = electronFakes.views[0].webContents
    const sameSessionParent = electronFakes.views[1].webContents
    const isolatedParent = electronFakes.views[2].webContents

    firstParent.session.siteData.set('oauth-state', 'deterministic-nonce')
    const { child } = electronFakes.openPopup(firstParent, 'http://127.0.0.1:4173/oauth/authorize')
    expect(child!.webContents.session.siteData.get('oauth-state')).toBe('deterministic-nonce')

    child!.webContents.session.siteData.set('auth-cookie', 'credential-free-test-token')
    expect(sameSessionParent.session.siteData.get('auth-cookie')).toBe('credential-free-test-token')
    expect(isolatedParent.session.siteData.has('oauth-state')).toBe(false)
    expect(isolatedParent.session.siteData.has('auth-cookie')).toBe(false)
  })

  it('closes all popup descendants when the parent live surface is destroyed', () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-cleanup',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const parentContents = electronFakes.views[0].webContents
    const first = electronFakes.openPopup(parentContents, 'https://auth.example/first').child!
    const nested = electronFakes.openPopup(first.webContents, 'https://auth.example/nested').child!
    const second = electronFakes.openPopup(parentContents, 'https://auth.example/second').child!

    surface.destroy()

    expect([first, nested, second].every(child => child.isDestroyed())).toBe(true)
    expect(parentContents.destroyed).toBe(true)
  })

  it('publishes complete coherent snapshots for loading, redirects, titles, history, and failures', () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents
    const states: TaskBrowserNativeState[] = []
    surface.onStateChanged(state => states.push(state))

    contents.url = 'https://example.com/start'
    contents.loading = true
    contents.emit('did-start-loading')

    contents.url = 'https://example.com/final'
    contents.historyIndex = 1
    contents.historyLength = 2
    contents.emit('did-navigate')

    contents.title = 'Final title'
    contents.emit('page-title-updated')

    contents.loading = false
    contents.emit('did-stop-loading')

    contents.emit('did-fail-load', {}, -105, 'Name not resolved', 'https://missing.example', true)
    contents.emit('did-fail-load', {}, -7, 'Subframe failure', 'https://frame.example', false)

    expect(states).toEqual([
      { url: 'https://example.com/start', title: '', loading: true, canGoBack: false, canGoForward: false, devToolsOpen: false, error: null },
      { url: 'https://example.com/final', title: '', loading: true, canGoBack: true, canGoForward: false, devToolsOpen: false, error: null },
      { url: 'https://example.com/final', title: 'Final title', loading: true, canGoBack: true, canGoForward: false, devToolsOpen: false, error: null },
      { url: 'https://example.com/final', title: 'Final title', loading: false, canGoBack: true, canGoForward: false, devToolsOpen: false, error: null },
      { url: 'https://example.com/final', title: 'Final title', loading: false, canGoBack: true, canGoForward: false, devToolsOpen: false, error: { code: '-105', message: 'Name not resolved', url: 'https://missing.example' } },
    ])

    states.at(-1)!.error!.message = 'mutated by observer'
    expect(surface.getState().error?.message).toBe('Name not resolved')
  })

  it('does not report an explicitly stopped navigation as a failure', () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents
    const states: TaskBrowserNativeState[] = []
    surface.onStateChanged(state => states.push(state))

    surface.stop()
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://cancelled.example', true)

    expect(states.at(-1)?.error).toBeNull()
  })

  it('keeps rejected loadURL cancellations out of structured failure state', async () => {
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const contents = electronFakes.views[0].webContents

    for (const code of [-3, 'ERR_ABORTED']) {
      contents.loadError = Object.assign(new Error('Navigation was aborted'), { code })
      await surface.loadURL('https://cancelled.example')
      expect(surface.getState().error, String(code)).toBeNull()
    }
  })

  it.each([
    ['../../report.txt', 'report.txt'],
    ['..\\..\\unsafe<name>.txt', 'unsafe_name_.txt'],
    ['CON.txt', '_CON.txt'],
    ['photo.jpg. ', 'photo.jpg'],
    ['   ...   ', 'download'],
  ])('sanitizes suggested download filenames before presentation: %s', (suggested, expected) => {
    expect(sanitizeTaskBrowserDownloadFilename(suggested)).toBe(expected)
  })

  it('bounds multibyte suggested filenames while preserving a short extension', () => {
    const sanitized = sanitizeTaskBrowserDownloadFilename(`${'😀'.repeat(100)}.txt`)

    expect(Buffer.byteLength(sanitized, 'utf8')).toBeLessThanOrEqual(200)
    expect(sanitized).toMatch(/\.txt$/)
  })

  it('configures one host-owned Save dialog with a sanitized filename without supplying a destination', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('../../unsafe<name>.txt')

    view.webContents.session.emit('will-download', {}, item, view.webContents)

    expect(item.saveDialogOptions).toEqual([{
      title: 'Save download',
      defaultPath: '/downloads/unsafe_name_.txt',
      buttonLabel: 'Save',
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    }])
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(0)

    item.emit('done', {}, 'completed')
    surface.destroy()
    expect(item.cancelCalls).toBe(0)
  })

  it('releases a download after Electron reports native Save dialog cancellation', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('report.txt')

    view.webContents.session.emit('will-download', {}, item, view.webContents)
    item.emit('done', {}, 'cancelled')
    surface.destroy()

    expect(item.saveDialogOptions).toHaveLength(1)
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(0)
  })

  it('fails closed when the host cannot configure the native Save dialog', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const item = new electronFakes.FakeDownloadItem('report.txt')
    item.saveDialogError = new Error('dialog unavailable')

    view.webContents.session.emit('will-download', {}, item, view.webContents)
    surface.destroy()

    expect(item.saveDialogOptions).toEqual([])
    expect(item.savePaths).toEqual([])
    expect(item.cancelCalls).toBe(1)
  })

  it('ignores foreign native download handles and cancels owned in-flight downloads during cleanup', () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    const view = electronFakes.views[0]
    const foreignItem = new electronFakes.FakeDownloadItem('foreign.txt')

    view.webContents.session.emit('will-download', {}, foreignItem, {})
    expect(foreignItem.saveDialogOptions).toEqual([])
    expect(foreignItem.cancelCalls).toBe(0)

    const ownedItem = new electronFakes.FakeDownloadItem('owned.txt')
    view.webContents.session.emit('will-download', {}, ownedItem, view.webContents)
    surface.destroy()

    expect(ownedItem.cancelCalls).toBe(1)
    expect(view.webContents.session.handlers.get('will-download')).toEqual([])
  })

  it('routes owned permission checks and requests through the host policy and fails closed otherwise', async () => {
    const permissionHandler = {
      check: vi.fn(() => true),
      request: vi.fn(async () => true),
    }
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-permissions',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
      permissionHandler,
    })
    const contents = electronFakes.views[0].webContents
    const browserSession = contents.session
    const check = browserSession.handlers.get('permission-check')![0] as unknown as (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: unknown,
    ) => boolean
    const request = browserSession.handlers.get('permission-request')![0] as unknown as (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
      details: unknown,
    ) => void
    const details = {
      requestingUrl: 'https://meet.example/room',
      securityOrigin: 'https://meet.example',
      mediaTypes: ['audio'],
      isMainFrame: true,
    }

    expect(check(contents, 'media', 'https://meet.example', {
      securityOrigin: 'https://meet.example',
      mediaType: 'audio',
      isMainFrame: true,
    })).toBe(true)
    expect(permissionHandler.check).toHaveBeenCalledWith({
      permission: 'media',
      requestingOrigin: 'https://meet.example',
      details: { securityOrigin: 'https://meet.example', mediaType: 'audio', isMainFrame: true },
    })

    const decisions: boolean[] = []
    request(contents, 'media', allowed => decisions.push(allowed), details)
    await vi.waitFor(() => expect(decisions).toEqual([true]))
    expect(permissionHandler.request).toHaveBeenCalledWith({
      windowId: 10,
      permission: 'media',
      details,
    })

    request({}, 'notifications', allowed => decisions.push(allowed), {
      requestingUrl: 'https://meet.example',
      isMainFrame: true,
    })
    expect(decisions).toEqual([true, false])

    surface.destroy()
    expect(check(contents, 'notifications', 'https://meet.example', { isMainFrame: true })).toBe(false)
  })
})
