import { describe, expect, it, vi } from 'vitest'

import { BrowserSurfaceError } from './browserSurfaces'
import { createMockBackendOpenForgeApi, createMockFrontendOpenForgeApi } from './testing'

describe('browser surfaces SDK contract', () => {
  it('provides an idempotent frontend testing fake with state, navigation, attachment, and lifecycle calls', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser', projectId: 'P-1' })
    const first = await api.browserSurfaces.getOrCreate({
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })
    const second = await api.browserSurfaces.getOrCreate({
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/ignored',
    })

    expect(second).toBe(first)
    await expect(first.getState()).resolves.toMatchObject({
      url: 'https://example.com/first',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    })

    const states: string[] = []
    const subscription = first.onStateChanged(state => states.push(state.url))
    const attachment = await first.attach(document.createElement('div'))
    await first.navigate('https://example.com/second')
    await first.goBack()
    await first.goForward()
    await first.reload()
    await first.stop()
    await expect(first.openDevTools('elements')).resolves.toMatchObject({ devToolsOpen: true })
    await expect(first.closeDevTools()).resolves.toMatchObject({ devToolsOpen: false })
    await attachment.dispose()

    api.__testing.registry.setBrowserSurfaceState('T-1', 'main', { title: 'Driven by test' })
    expect((await first.getState()).title).toBe('Driven by test')
    expect(states).toContain('https://example.com/second')

    await subscription.dispose()
    await first.destroy()

    expect(api.__testing.calls.browserSurfaceGetOrCreate).toEqual([
      { taskId: 'T-1', id: 'main', initialUrl: 'https://example.com/first' },
      { taskId: 'T-1', id: 'main', initialUrl: 'https://example.com/ignored' },
    ])
    expect(api.__testing.calls.browserSurfaceAttachments).toHaveLength(1)
    expect(api.__testing.calls.browserSurfaceNavigations).toEqual([
      { taskId: 'T-1', id: 'main', url: 'https://example.com/second' },
    ])
    expect(api.__testing.calls.browserSurfaceControls).toEqual([
      { taskId: 'T-1', id: 'main', action: 'goBack' },
      { taskId: 'T-1', id: 'main', action: 'goForward' },
      { taskId: 'T-1', id: 'main', action: 'reload' },
      { taskId: 'T-1', id: 'main', action: 'stop' },
      { taskId: 'T-1', id: 'main', action: 'openDevTools', panel: 'elements' },
      { taskId: 'T-1', id: 'main', action: 'closeDevTools' },
    ])
    expect(api.__testing.calls.browserSurfaceDetaches).toEqual([{ taskId: 'T-1', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceDestroys).toEqual([{ taskId: 'T-1', id: 'main' }])
    await expect(first.getState()).rejects.toMatchObject({
      name: 'BrowserSurfaceError',
      code: 'SURFACE_DESTROYED',
    })
  })

  it('keeps the testing fake aligned with the popup/download-free public method set', async () => {
    const apiMethods = ['getOrCreate', 'resetSession'] as const
    const controllerMethods = [
      'attach',
      'detach',
      'destroy',
      'getState',
      'onStateChanged',
      'navigate',
      'goBack',
      'goForward',
      'reload',
      'stop',
      'openDevTools',
      'closeDevTools',
      'selectVisibleRegion',
      'captureVisibleViewport',
      'discardCapture',
    ] as const
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-1', id: 'main' })

    expect(Object.keys(api.browserSurfaces).sort()).toEqual([...apiMethods].sort())
    for (const method of controllerMethods) {
      expect(surface[method], method).toBeTypeOf('function')
    }
  })

  it('supports blank initial state, navigation errors, and Plugin Browser Session reset in tests', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-2', id: 'main' })

    expect((await surface.getState()).url).toBe('about:blank')
    await expect(surface.navigate('file:///tmp/secret')).rejects.toBeInstanceOf(BrowserSurfaceError)
    await expect(surface.navigate('file:///tmp/secret')).rejects.toMatchObject({ code: 'INVALID_URL' })

    await api.browserSurfaces.resetSession()
    expect(api.__testing.calls.browserSurfaceSessionResets).toEqual([{}])
    await expect(surface.getState()).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('restores only the URL supplied from plugin-owned Task storage and keeps Tasks isolated', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const taskStorage = api.storage.task('T-restored')
    const surface = await api.browserSurfaces.getOrCreate({
      taskId: 'T-restored',
      id: 'main',
      initialUrl: 'https://example.com/start',
    })
    const committed = await surface.navigate('https://example.com/committed')
    await taskStorage.set('lastUrl', committed.url)

    const otherTask = await api.browserSurfaces.getOrCreate({ taskId: 'T-isolated', id: 'main' })
    await expect(otherTask.getState()).resolves.toMatchObject({ url: 'about:blank' })

    await surface.destroy()
    const withoutSavedUrl = await api.browserSurfaces.getOrCreate({ taskId: 'T-restored', id: 'main' })
    await expect(withoutSavedUrl.getState()).resolves.toMatchObject({ url: 'about:blank' })

    await withoutSavedUrl.destroy()
    const savedUrl = await taskStorage.get<string>('lastUrl')
    const restored = await api.browserSurfaces.getOrCreate({
      taskId: 'T-restored',
      id: 'main',
      initialUrl: savedUrl ?? undefined,
    })

    await expect(restored.getState()).resolves.toMatchObject({ url: 'https://example.com/committed' })
    await expect(otherTask.getState()).resolves.toMatchObject({ url: 'about:blank' })
  })

  it('keeps browser surfaces unavailable to backend plugin APIs', () => {
    const backend = createMockBackendOpenForgeApi()
    expect(backend).not.toHaveProperty('browserSurfaces')
    expect(vi.fn()).not.toHaveBeenCalled()
  })

  it('drives coherent history and isolated failure snapshots through the testing API', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const surface = await api.browserSurfaces.getOrCreate({
      taskId: 'T-history',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })

    await surface.navigate('https://example.com/second')
    await surface.navigate('https://example.com/third')
    await expect(surface.goBack()).resolves.toMatchObject({
      url: 'https://example.com/second',
      canGoBack: true,
      canGoForward: true,
    })
    await expect(surface.goForward()).resolves.toMatchObject({
      url: 'https://example.com/third',
      canGoBack: true,
      canGoForward: false,
    })

    const navigationFailure = {
      code: '-105',
      message: 'Name not resolved',
      url: 'https://missing.example',
    }
    const observedFailures: string[] = []
    surface.onStateChanged(state => {
      if (state.error) state.error.message = 'mutated by first observer'
    })
    surface.onStateChanged(state => {
      if (state.error) observedFailures.push(state.error.message)
    })
    api.__testing.registry.setBrowserSurfaceState('T-history', 'main', {
      loading: false,
      error: navigationFailure,
    })
    navigationFailure.message = 'mutated by test after publication'

    await expect(surface.getState()).resolves.toMatchObject({
      url: 'https://example.com/third',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      error: { code: '-105', message: 'Name not resolved', url: 'https://missing.example' },
    })
    expect(observedFailures).toEqual(['Name not resolved'])
    expect(api.__testing.calls.browserSurfaceControls).toEqual([
      { taskId: 'T-history', id: 'main', action: 'goBack' },
      { taskId: 'T-history', id: 'main', action: 'goForward' },
    ])
  })

  it('captures and explicitly discards a serializable immutable viewport artifact in the testing fake', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-capture', id: 'main' })

    const selection = await surface.selectVisibleRegion()
    const capture = await surface.captureVisibleViewport()
    await surface.clearVisualFeedback()
    await surface.replaceVisualFeedback([{
      annotationNumber: 1,
      url: 'https://example.com/',
      region: { x: 0.2, y: 0.1, width: 0.4, height: 0.4 },
      comment: 'Corrected example feedback',
    }])
    await expect(surface.captureExists(capture.artifactId)).resolves.toBe(true)

    expect(capture).toEqual({
      artifactId: expect.stringMatching(/^capture-/),
      absolutePath: expect.stringMatching(/^\/tmp\/openforge-browser-captures\/T-capture\/capture-/),
      mediaType: 'image/png',
      width: 800,
      height: 600,
      url: 'about:blank',
      title: '',
      capturedAt: '2026-01-01T00:00:00.000Z',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })
    expect(selection).toEqual({
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      comment: 'Example visual feedback',
      annotationNumber: 1,
    })
    expect(JSON.parse(JSON.stringify(capture))).toEqual(capture)
    expect(api.__testing.calls.browserSurfaceSelections).toEqual([{ taskId: 'T-capture', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceFeedbackClears).toEqual([{ taskId: 'T-capture', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceCaptures).toEqual([{ taskId: 'T-capture', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceFeedbackReplacements).toEqual([{
      taskId: 'T-capture',
      id: 'main',
      feedback: [{
        annotationNumber: 1,
        url: 'https://example.com/',
        region: { x: 0.2, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Corrected example feedback',
      }],
    }])
    expect(api.__testing.calls.browserSurfaceCaptureChecks).toEqual([{
      taskId: 'T-capture', id: 'main', artifactId: capture.artifactId,
    }])

    await surface.discardCapture(capture.artifactId)
    await expect(surface.captureExists(capture.artifactId)).resolves.toBe(false)
    expect(api.__testing.calls.browserSurfaceCaptureDiscards).toEqual([
      { taskId: 'T-capture', id: 'main', artifactId: capture.artifactId },
    ])
  })
})
