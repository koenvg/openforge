import { beforeEach, describe, expect, it } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import type { TaskBrowserNativeState } from './taskBrowserSurfaceManager'
import {
  ElectronTaskBrowserSurfaceFactory,
  electronRendererZoomFactor,
} from './taskBrowserSurfaceElectronAdapter'

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

  it('captures only the current visible viewport as PNG with native dimensions', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-capture',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })

    const contents = electronFakes.views[0].webContents
    contents.executeJavaScriptResult = {
      url: 'about:blank',
      width: 640,
      height: 480,
      scrollX: 0,
      scrollY: 0,
    }
    await surface.replaceVisualFeedback([{
      annotationNumber: 1,
      url: 'about:blank',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      comment: 'Keep comments out of captured evidence',
    }])
    expect(contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')))
      .toContain('Visual feedback comments')
    contents.executeJavaScriptCalls.length = 0

    const capture = await surface.captureVisibleViewport()

    expect(contents.capturePageCalls).toEqual([undefined])
    expect(contents.executeJavaScriptCalls).toHaveLength(2)
    expect(contents.executeJavaScriptCalls[0]).toContain("annotations.style.display = \"none\"")
    expect(contents.executeJavaScriptCalls[0]).toContain("annotations.setAttribute('aria-hidden', 'true')")
    expect(contents.executeJavaScriptCalls[1]).toContain("annotations.style.display = \"\"")
    expect(contents.executeJavaScriptCalls[1]).toContain("annotations.removeAttribute('aria-hidden')")
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

})
