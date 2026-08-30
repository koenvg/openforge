import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'

describe('Task Browser visual feedback integration', () => {
  beforeEach(() => electronFakes.reset())

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

})
