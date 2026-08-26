import { describe, expect, it, vi } from 'vitest'

import {
  SECURE_TASK_BROWSER_POPUP_POLICY,
  SECURE_TASK_BROWSER_WEB_PREFERENCES,
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceManager'
import { createTaskBrowserSurfaceManagerFixture as createManager } from './taskBrowserSurfaceManager.testUtils'

describe('Task Browser Surface Manager', () => {
  it('creates one secure live surface per window, plugin, Task, and local id', async () => {
    const { manager, factory, permissions, permissionHandler, authorize } = createManager()

    const first = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })
    const again = await manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/ignored',
    })
    const otherWindow = await manager.getOrCreate({
      windowId: 11,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
    })

    expect(first).toEqual({
      surfaceId: 'task-browser-surface-1',
      generation: 1,
      state: {
        url: 'https://example.com/first',
        title: '',
        loading: true,
        canGoBack: true,
        canGoForward: false,
        devToolsOpen: false,
        error: null,
      },
    })
    expect(again.surfaceId).toBe(first.surfaceId)
    expect(otherWindow.surfaceId).not.toBe(first.surfaceId)
    expect(factory.creations).toHaveLength(2)
    expect(factory.surfaces[0].loadCalls).toEqual(['https://example.com/first'])
    expect(factory.surfaces[1].loadCalls).toEqual([])
    expect(authorize).toHaveBeenCalledTimes(3)
    expect(factory.creations[0]).toMatchObject({
      windowId: 10,
      partition: expect.stringMatching(/^persist:openforge-plugin-browser-/),
      webPreferences: SECURE_TASK_BROWSER_WEB_PREFERENCES,
      popupPolicy: SECURE_TASK_BROWSER_POPUP_POLICY,
    })
    expect(factory.creations[0].permissionHandler).toBe(permissionHandler)
    expect(permissions.createSessionHandler).toHaveBeenCalledTimes(2)
    expect(permissions.createSessionHandler).toHaveBeenCalledWith('browser')
    expect(factory.creations[1].partition).toBe(factory.creations[0].partition)
  })

  it('keeps concurrent callers pending until the initial URL load completes', async () => {
    let releaseInitialLoad: (() => void) | null = null
    const { manager, factory } = createManager()
    factory.loadGate = new Promise<void>(resolve => { releaseInitialLoad = resolve })

    const first = manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-load-serialization',
      id: 'main',
      initialUrl: 'https://example.com',
    })
    await Promise.resolve()
    await Promise.resolve()
    let secondSettled = false
    const second = manager
      .getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-load-serialization', id: 'main' })
      .then(reference => {
        secondSettled = true
        return reference
      })
    await Promise.resolve()
    await Promise.resolve()
    const settledBeforeLoad = secondSettled

    ;(releaseInitialLoad as (() => void) | null)?.()
    const [firstReference, secondReference] = await Promise.all([first, second])

    expect(settledBeforeLoad).toBe(false)
    expect(secondReference.surfaceId).toBe(firstReference.surfaceId)
    expect(factory.creations).toHaveLength(1)
  })
  it('serializes concurrent getOrCreate calls for the same live identity', async () => {
    let releaseAuthorization: (() => void) | null = null
    const authorize = vi.fn(() => new Promise<void>(resolve => { releaseAuthorization = resolve }))
    const { manager, factory } = createManager({ authorize })

    const first = manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    const second = manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })
    await Promise.resolve()
    ;(releaseAuthorization as (() => void) | null)?.()

    const [a, b] = await Promise.all([first, second])
    expect(a.surfaceId).toBe(b.surfaceId)
    expect(factory.creations).toHaveLength(1)
    expect(authorize).toHaveBeenCalledOnce()
  })

  it('validates identifiers, URLs, window ownership, and project authorization with named errors', async () => {
    const denied = createManager({
      authorize: async () => {
        throw new TaskBrowserSurfaceError('PLUGIN_NOT_ENABLED', 'Plugin is not enabled for this Task project')
      },
    }).manager

    await expect(denied.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' }))
      .rejects.toMatchObject({ name: 'TaskBrowserSurfaceError', code: 'PLUGIN_NOT_ENABLED' })

    const { manager } = createManager()
    await expect(manager.getOrCreate({ windowId: 999, pluginId: 'browser', taskId: 'T-1', id: 'main' }))
      .rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: '', id: 'main' }))
      .rejects.toMatchObject({ code: 'INVALID_TASK' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'bad id' }))
      .rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main', initialUrl: 'file:///tmp/secret' }))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('clamps bounds and uses attachment generations to preserve the newest attachment', async () => {
    const { manager, factory, stateEvents } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-1', id: 'main' })

    manager.attach(created.surfaceId, 'old', 1, { x: -20, y: 20, width: 900, height: 700 })
    manager.attach(created.surfaceId, 'new', 2, { x: 30, y: 40, width: 300, height: 200 })
    manager.attach(created.surfaceId, 'old', 1, { x: 400, y: 400, width: 100, height: 100 })
    manager.detach(created.surfaceId, 'old', 1)

    expect(factory.surfaces[0].attachedWindowId).toBe(10)
    expect(factory.surfaces[0].bounds).toEqual([
      { x: 0, y: 20, width: 800, height: 580 },
      { x: 30, y: 40, width: 300, height: 200 },
    ])

    factory.surfaces[0].emit({ title: 'Example', loading: true })
    expect(stateEvents).toEqual([
      expect.objectContaining({ surfaceId: created.surfaceId, state: expect.objectContaining({ title: 'Example', loading: true }) }),
    ])
    await expect(manager.getState(created.surfaceId)).resolves.toMatchObject({ title: 'Example', loading: true })

    manager.attach(created.surfaceId, 'new', 2, { x: -20, y: 10, width: 100, height: 100 })
    manager.updateWindowBounds(10, { x: 0, y: 0, width: 50, height: 50 })
    expect(factory.surfaces[0].bounds.slice(-2)).toEqual([
      { x: 0, y: 10, width: 80, height: 100 },
      { x: 0, y: 10, width: 50, height: 40 },
    ])

    manager.attach(created.surfaceId, 'new', 2, null)
    expect(factory.surfaces[0].attachedWindowId).toBeNull()
    manager.attach(created.surfaceId, 'new', 2, { x: 5, y: 6, width: 20, height: 30 })
    expect(factory.surfaces[0].attachedWindowId).toBe(10)

    manager.detach(created.surfaceId, 'new', 2)
    manager.attach(created.surfaceId, 'new', 2, { x: 7, y: 8, width: 20, height: 30 })
    expect(factory.surfaces[0].attachedWindowId).toBeNull()

    manager.attach(created.surfaceId, 'tiny', 3, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(factory.surfaces[0].attachedWindowId).toBeNull()
    manager.attach(created.surfaceId, 'tiny', 3, { x: 0.1, y: 0.1, width: 1.2, height: 1.2 })
    expect(factory.surfaces[0].attachedWindowId).toBe(10)
    expect(factory.surfaces[0].bounds.at(-1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })

    expect(() => manager.attach(created.surfaceId, 'replacement', 4, { x: 0, y: 0, width: -1, height: 20 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_BOUNDS' }))

    await manager.destroy(created.surfaceId)
    expect(factory.surfaces[0].destroyed).toBe(true)
    await expect(manager.getState(created.surfaceId)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('converts renderer CSS pixel attachment bounds with the current renderer zoom factor', async () => {
    const zoomFactors = new Map<number, number>([[10, 1.25]])
    const { manager, factory } = createManager({ rendererZoomFactor: windowId => zoomFactors.get(windowId) ?? 1 })
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-zoom', id: 'main' })
    const native = factory.surfaces[0]

    // A pane covering device-independent pixels 300,200 -> 800,600 of the zoomed window measures 400x320 CSS pixels.
    manager.attach(created.surfaceId, 'main', 1, { x: 240, y: 160, width: 400, height: 320 })
    expect(native.bounds.at(-1)).toEqual({ x: 300, y: 200, width: 500, height: 400 })

    // Zooming out grows the same pane's CSS pixel measurements, but it still covers the same window region.
    zoomFactors.set(10, 0.8)
    manager.attach(created.surfaceId, 'main', 1, { x: 375, y: 250, width: 625, height: 500 })
    expect(native.bounds.at(-1)).toEqual({ x: 300, y: 200, width: 500, height: 400 })

    // Window resizes replay the last renderer measurement, so they must re-read the zoom factor rather than reuse a scaled rect.
    zoomFactors.set(10, 1.25)
    manager.updateWindowBounds(10, { x: 0, y: 0, width: 800, height: 600 })
    expect(native.bounds.at(-1)).toEqual({ x: 469, y: 313, width: 331, height: 287 })

    // Bounds are clamped after conversion, so a pane that only fits unscaled must not be attached.
    manager.attach(created.surfaceId, 'main', 1, { x: 700, y: 500, width: 200, height: 200 })
    expect(native.attachedWindowId).toBeNull()
  })

  it('controls HTTP(S) navigation and returns complete history and loading snapshots', async () => {
    const { manager, factory, stateEvents } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-nav', id: 'main' })
    const native = factory.surfaces[0]

    await expect(manager.navigate(created.surfaceId, 'https://example.com/first')).resolves.toEqual({
      url: 'https://example.com/first',
      title: '',
      loading: true,
      canGoBack: true,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    })
    await manager.navigate(created.surfaceId, 'http://example.com/second')
    await expect(manager.goBack(created.surfaceId)).resolves.toMatchObject({
      url: 'https://example.com/first',
      canGoBack: true,
      canGoForward: true,
    })
    await manager.goBack(created.surfaceId)
    await manager.goBack(created.surfaceId)
    await expect(manager.goForward(created.surfaceId)).resolves.toMatchObject({
      url: 'https://example.com/first',
      canGoBack: true,
      canGoForward: true,
    })
    await expect(manager.reload(created.surfaceId)).resolves.toMatchObject({ loading: true, error: null })
    await expect(manager.stop(created.surfaceId)).resolves.toMatchObject({ loading: false })
    await expect(manager.openDevTools(created.surfaceId, 'console')).resolves.toMatchObject({ devToolsOpen: true })
    await expect(manager.closeDevTools(created.surfaceId)).resolves.toMatchObject({ devToolsOpen: false })

    expect(native.controlCalls).toEqual([
      'goBack',
      'goBack',
      'goForward',
      'reload',
      'stop',
      'openDevTools',
      'closeDevTools',
    ])
    expect(native.devToolsPanels).toEqual(['console'])
    expect(stateEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId: 10,
        surfaceId: created.surfaceId,
        generation: created.generation,
        state: expect.objectContaining({ url: 'https://example.com/first', canGoForward: true }),
      }),
    ]))
    for (const event of stateEvents) {
      expect(event.state).toEqual(expect.objectContaining({
        url: expect.any(String),
        title: expect.any(String),
        loading: expect.any(Boolean),
        canGoBack: expect.any(Boolean),
        canGoForward: expect.any(Boolean),
      }))
      expect(event.state).toHaveProperty('error')
    }
  })

  it.each([
    'about:blank',
    'file:///tmp/secret',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'plugin://browser/page',
    'openforge://internal',
    'mailto:user@example.com',
    'not a url',
  ])('blocks unsupported plugin navigation destinations: %s', async blockedUrl => {
    const { manager } = createManager()
    const created = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-policy', id: 'main' })

    await expect(manager.navigate(created.surfaceId, blockedUrl)).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('rejects state events from destroyed native generations while keeping windows isolated', async () => {
    const { manager, factory, stateEvents } = createManager()
    const first = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    const otherWindow = await manager.getOrCreate({ windowId: 11, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    const staleListener = Array.from(factory.surfaces[0].listeners)[0]
    expect(staleListener).toBeDefined()

    await manager.destroy(first.surfaceId)
    const replacement = await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-stale', id: 'main' })
    staleListener?.({
      url: 'https://stale.example',
      title: 'Stale',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: { code: '-105', message: 'stale failure', url: 'https://stale.example' },
    })
    factory.surfaces[1].emit({ title: 'Other window' })
    factory.surfaces[2].emit({ title: 'Replacement' })

    expect(replacement.generation).not.toBe(first.generation)
    expect(stateEvents).toEqual([
      expect.objectContaining({ windowId: 11, surfaceId: otherWindow.surfaceId, state: expect.objectContaining({ title: 'Other window' }) }),
      expect.objectContaining({ windowId: 10, surfaceId: replacement.surfaceId, state: expect.objectContaining({ title: 'Replacement' }) }),
    ])
    expect(stateEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ state: expect.objectContaining({ title: 'Stale' }) }),
    ]))
  })
})
