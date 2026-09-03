import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
} from './taskBrowserSurfaceManager'
import { ElectronTaskBrowserSurfaceFactory } from './taskBrowserSurfaceElectronAdapter'
import { TaskBrowserVisualFeedbackController } from './taskBrowserVisualFeedback'

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
    expect(script).toContain('annotationsRoot.dataset.pageUrl = String(currentPageUrl)')
    expect(script).toContain("annotation.style.cssText = 'position:absolute")
    expect(script).toContain('pointer-events:none')
    expect(script).not.toContain('outerHTML')
    expect(script).not.toContain('document.querySelector')

    await surface.loadURL('https://second.example/')
    electronFakes.views[0].webContents.executeJavaScriptResult = {
      region: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
      comment: 'Second page feedback',
      annotation: { number: 2, x: 128, y: 144, width: 128, height: 96 },
    }
    await surface.selectVisibleRegion()
    expect(electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1)).toContain('const nextAnnotationNumber = 2')

    await surface.clearVisualFeedback()
    expect(electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1))
      .toContain("const annotations = document.getElementById('__openforge_visual_feedback_annotations__')")
    expect(electronFakes.views[0].webContents.executeJavaScriptCalls.at(-1))
      .toContain('__openforgeVisualFeedbackCommentsCleanup')
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
    }], { appearance: 'light' })

    const script = contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')) ?? ''
    expect(script).toContain('Corrected live marker')
    expect(script).toContain('const visualFeedbackAppearance = "light";')
    expect(script).toContain('"region":{"x":0.25,"y":0.1,"width":0.5,"height":0.2}')
    expect(script).toContain('"x":160')
    expect(script).toContain('"y":168')
    expect(window.removedViews).toEqual([])
    expect(contents.capturePageCalls).toEqual([])
  })

  it('renders the comment card from only the exact visible URL feedback', async () => {
    electronFakes.registerWindow(10)
    const surface = new ElectronTaskBrowserSurfaceFactory().createSurface({
      windowId: 10,
      partition: 'persist:test-browser-current-url-comments',
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    surface.attach(10, { x: 0, y: 0, width: 640, height: 480 })
    const contents = electronFakes.views[0].webContents
    await surface.loadURL('https://current.example/path')
    contents.executeJavaScriptResult = {
      url: 'https://current.example/path',
      width: 640,
      height: 480,
      scrollX: 0,
      scrollY: 0,
    }

    await surface.replaceVisualFeedback([
      {
        annotationNumber: 4,
        url: 'https://other.example/path',
        region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        comment: 'Comment from another URL',
      },
      {
        annotationNumber: 7,
        url: 'https://current.example/path',
        region: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
        comment: 'Comment for the visible URL',
      },
    ])

    const script = contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')) ?? ''
    expect(script).toContain('Visual feedback comments')
    expect(script).toContain('Comment for the visible URL')
    expect(script).not.toContain('Comment from another URL')

    await surface.replaceVisualFeedback([])
    const emptyScript = contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')) ?? ''
    expect(emptyScript).toContain('const savedAnnotations = [];')
    expect(emptyScript).toContain('annotationsRoot.replaceChildren();')
  })

  it('emits delete actions only for synchronized annotations on the exact current URL', async () => {
    let currentUrl = 'https://current.example/path'
    const pendingActions: Promise<unknown>[] = []
    const contents = {
      isDestroyed: () => false,
      getURL: () => currentUrl,
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('url: location.href')) {
          return {
            url: currentUrl,
            width: 640,
            height: 480,
            scrollX: 0,
            scrollY: 0,
          }
        }
        return undefined
      }),
      executeJavaScriptInIsolatedWorld: vi.fn(async (
        _worldId: number,
        scripts: Array<{ code: string }>,
      ) => scripts[0]?.code.includes('__openforgeVisualFeedbackActionWaitCleanup')
        ? pendingActions.shift() ?? null
        : null),
    }
    const controller = new TaskBrowserVisualFeedbackController(contents as never, () => false, () => true)
    const actions: unknown[] = []
    controller.onVisualFeedbackAction(action => actions.push(action))
    const feedback = [{
      annotationNumber: 4,
      url: 'https://current.example/path',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'Delete from the card',
    }]

    let resolveValid!: (action: unknown) => void
    pendingActions.push(new Promise(resolve => { resolveValid = resolve }))
    await controller.replaceVisualFeedback(feedback)
    resolveValid({ type: 'delete-annotation', annotationNumber: 4 })
    await vi.waitFor(() => expect(actions).toEqual([
      { type: 'delete-annotation', annotationNumber: 4 },
    ]))
    const isolatedActionCall = contents.executeJavaScriptInIsolatedWorld.mock.calls[0]
    expect(isolatedActionCall?.[0]).toBe(1_001)
    expect(isolatedActionCall?.[1]?.[0]?.code).toContain('if (!event.isTrusted) return;')
    expect(isolatedActionCall?.[1]?.[0]?.code).toContain('deleteControls.has(control)')

    let resolveStaleUrl!: (action: unknown) => void
    pendingActions.push(new Promise(resolve => { resolveStaleUrl = resolve }))
    await controller.replaceVisualFeedback(feedback)
    currentUrl = 'https://other.example/path'
    resolveStaleUrl({ type: 'delete-annotation', annotationNumber: 4 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(actions).toHaveLength(1)

    currentUrl = 'https://current.example/path'
    let resolveUnknown!: (action: unknown) => void
    pendingActions.push(new Promise(resolve => { resolveUnknown = resolve }))
    await controller.replaceVisualFeedback(feedback)
    resolveUnknown({ type: 'delete-annotation', annotationNumber: 99 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(actions).toHaveLength(1)
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
    expect(contents.executeJavaScriptCalls.at(-1)).toContain("const annotations = document.getElementById('__openforge_visual_feedback_annotations__')")
    expect(contents.executeJavaScriptCalls.at(-1)).toContain('__openforgeVisualFeedbackCommentsCleanup')

    contents.url = 'https://first.example/'
    contents.emit('did-navigate')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.slice().reverse().find(call =>
      call.includes('const savedAnnotations'))).toContain('First page feedback'))
    const firstPageScript = contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')) ?? ''
    expect(firstPageScript).toContain('Visual feedback comments')
    expect(firstPageScript).not.toContain('Second page feedback')

    contents.url = 'https://second.example/'
    contents.emit('did-navigate-in-page')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.slice().reverse().find(call =>
      call.includes('const savedAnnotations'))).toContain('Second page feedback'))
    const secondPageScript = contents.executeJavaScriptCalls.slice().reverse().find(call => call.includes('const savedAnnotations')) ?? ''
    expect(secondPageScript).toContain('Visual feedback comments')
    expect(secondPageScript).not.toContain('First page feedback')

    contents.executeJavaScriptCalls.length = 0
    contents.historyIndex = 1
    contents.historyLength = 2
    await surface.goBack()
    expect(contents.executeJavaScriptCalls.at(-1)).toContain("const annotations = document.getElementById('__openforge_visual_feedback_annotations__')")

    contents.url = 'https://first.example/'
    contents.emit('did-navigate')
    await vi.waitFor(() => expect(contents.executeJavaScriptCalls.slice().reverse().find(call =>
      call.includes('const savedAnnotations'))).toContain('First page feedback'))
  })

})
