import { describe, expect, it, vi } from 'vitest'

import { TaskBrowserSurfaceIpcRouter, isTaskBrowserSurfaceCommand } from './taskBrowserSurfaceIpc'
import { TaskBrowserSurfaceError } from './taskBrowserSurfaceManager'

function managerFake() {
  return {
    getOrCreate: vi.fn(async () => ({
      surfaceId: 'surface-1',
      generation: 1,
      state: { url: 'about:blank', title: '', loading: false, canGoBack: false, canGoForward: false, error: null },
    })),
    assertWindowRegistered: vi.fn(),
    assertWindowOwnsSurface: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    destroy: vi.fn(async () => undefined),
    getState: vi.fn(async () => ({ url: 'about:blank' })),
    navigate: vi.fn(async () => ({ url: 'https://example.com' })),
    goBack: vi.fn(async () => ({ url: 'about:blank' })),
    goForward: vi.fn(async () => ({ url: 'https://example.com' })),
    reload: vi.fn(async () => ({ url: 'https://example.com' })),
    stop: vi.fn(async () => ({ url: 'https://example.com' })),
    openDevTools: vi.fn(async () => ({ devToolsOpen: true })),
    closeDevTools: vi.fn(async () => ({ devToolsOpen: false })),
    selectVisibleRegion: vi.fn(async () => ({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })),
    clearVisualFeedback: vi.fn(async () => undefined),
    replaceVisualFeedback: vi.fn(async () => undefined),
    captureExists: vi.fn(async () => true),
    captureVisibleViewport: vi.fn(async () => ({
      artifactId: 'capture-1', mediaType: 'image/png', width: 800, height: 600, dataUrl: 'data:image/png;base64,cG5n',
    })),
    discardCapture: vi.fn(async () => undefined),
    resetSession: vi.fn(async () => undefined),
    destroyPlugin: vi.fn(),
  }
}

describe('Task Browser Surface IPC router', () => {
  it('recognizes and routes serializable browser commands with the trusted sender window', async () => {
    const manager = managerFake()
    const router = new TaskBrowserSurfaceIpcRouter(manager as never)

    expect(isTaskBrowserSurfaceCommand('task_browser_surface_get_or_create')).toBe(true)
    expect(isTaskBrowserSurfaceCommand('get_tasks')).toBe(false)
    await expect(router.handle('task_browser_surface_get_or_create', {
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com',
    }, 10)).resolves.toMatchObject({ ok: true, value: { surfaceId: 'surface-1' } })

    expect(manager.getOrCreate).toHaveBeenCalledWith({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com',
    })

    await expect(router.handle('task_browser_surface_attach', {
      surfaceId: 'surface-1',
      attachmentId: 'attachment-2',
      attachmentGeneration: 2,
      bounds: null,
    }, 10)).resolves.toMatchObject({ ok: true })
    expect(manager.attach).toHaveBeenCalledWith('surface-1', 'attachment-2', 2, null)

    await router.handle('task_browser_surface_detach', {
      surfaceId: 'surface-1',
      attachmentId: 'attachment-2',
      attachmentGeneration: 2,
    }, 10)
    expect(manager.detach).toHaveBeenCalledWith('surface-1', 'attachment-2', 2)
    expect(isTaskBrowserSurfaceCommand('task_browser_surface_open_devtools')).toBe(true)
    await expect(router.handle('task_browser_surface_open_devtools', { surfaceId: 'surface-1', panel: 'console' }, 10))
      .resolves.toEqual({ ok: true, value: { devToolsOpen: true } })
    await expect(router.handle('task_browser_surface_close_devtools', { surfaceId: 'surface-1' }, 10))
      .resolves.toEqual({ ok: true, value: { devToolsOpen: false } })
    expect(manager.openDevTools).toHaveBeenCalledWith('surface-1', 'console')
    expect(manager.closeDevTools).toHaveBeenCalledWith('surface-1')
  })

  it('routes capture and discard with explicit plugin, Task, window, and surface generation scope', async () => {
    const manager = managerFake()
    const router = new TaskBrowserSurfaceIpcRouter(manager as never)
    const owner = {
      pluginId: 'browser',
      taskId: 'T-1',
      surfaceId: 'surface-1',
      generation: 7,
    }

    await expect(router.handle('task_browser_surface_select_visible_region', owner, 10)).resolves.toMatchObject({
      ok: true,
      value: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(manager.selectVisibleRegion).toHaveBeenCalledWith({ windowId: 10, ...owner })

    await expect(router.handle('task_browser_surface_clear_visual_feedback', owner, 10)).resolves.toMatchObject({ ok: true })
    expect(manager.clearVisualFeedback).toHaveBeenCalledWith({ windowId: 10, ...owner })

    const feedback = [{
      annotationNumber: 1,
      url: 'https://example.com/',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      comment: 'Corrected feedback',
    }]
    await expect(router.handle('task_browser_surface_replace_visual_feedback', {
      ...owner,
      feedback,
      presentation: { appearance: 'light' },
    }, 10)).resolves.toMatchObject({ ok: true })
    expect(manager.replaceVisualFeedback).toHaveBeenCalledWith(
      { windowId: 10, ...owner },
      feedback,
      { appearance: 'light' },
    )
    await expect(router.handle('task_browser_surface_capture_exists', { ...owner, artifactId: 'capture-1' }, 10))
      .resolves.toEqual({ ok: true, value: true })
    expect(manager.captureExists).toHaveBeenCalledWith({ windowId: 10, ...owner, artifactId: 'capture-1' })

    await expect(router.handle('task_browser_surface_capture_visible_viewport', owner, 10)).resolves.toMatchObject({
      ok: true,
      value: { artifactId: 'capture-1', width: 800, height: 600 },
    })
    expect(manager.captureVisibleViewport).toHaveBeenCalledWith({ windowId: 10, ...owner })

    await expect(router.handle('task_browser_surface_discard_capture', {
      ...owner,
      artifactId: 'capture-1',
    }, 10)).resolves.toMatchObject({ ok: true })
    expect(manager.discardCapture).toHaveBeenCalledWith({ windowId: 10, ...owner, artifactId: 'capture-1' })
  })


  it('checks window ownership for controller operations and returns named error envelopes', async () => {
    const manager = managerFake()
    manager.assertWindowOwnsSurface.mockImplementation(() => {
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Surface belongs to another window')
    })
    const router = new TaskBrowserSurfaceIpcRouter(manager as never)

    await expect(router.handle('task_browser_surface_destroy', { surfaceId: 'surface-1' }, 11)).resolves.toEqual({
      ok: false,
      error: { code: 'HOST_UNAVAILABLE', message: 'Surface belongs to another window' },
    })
    expect(manager.destroy).not.toHaveBeenCalled()
  })

  it('returns a host error when Chromium DevTools fail to open', async () => {
    const manager = managerFake()
    manager.openDevTools.mockRejectedValueOnce(new Error('Chromium Developer Tools did not open'))
    const router = new TaskBrowserSurfaceIpcRouter(manager as never)

    await expect(router.handle(
      'task_browser_surface_open_devtools',
      { surfaceId: 'surface-1' },
      10,
    )).resolves.toEqual({
      ok: false,
      error: { code: 'HOST_UNAVAILABLE', message: 'Chromium Developer Tools did not open' },
    })
  })

  it('fails missing Electron sender windows and malformed payloads with named errors', async () => {
    const router = new TaskBrowserSurfaceIpcRouter(managerFake() as never)

    await expect(router.handle('task_browser_surface_get_or_create', {}, null)).resolves.toMatchObject({
      ok: false,
      error: { code: 'HOST_UNAVAILABLE' },
    })
    await expect(router.handle('task_browser_surface_attach', {
      surfaceId: 'surface-1',
      attachmentId: 'a',
      attachmentGeneration: 1,
      bounds: { x: 0 },
    }, 10)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_BOUNDS' },
    })
    await expect(router.handle('task_browser_surface_attach', {
      surfaceId: 'surface-1',
      attachmentId: 'a',
      attachmentGeneration: 0,
      bounds: null,
    }, 10)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ID' },
    })
    await expect(router.handle('task_browser_surface_open_devtools', { surfaceId: 'surface-1', panel: 'network' }, 10))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ID' } })
  })
})
