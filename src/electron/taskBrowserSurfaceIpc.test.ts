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

  it('fails missing Electron sender windows and malformed payloads with named errors', async () => {
    const router = new TaskBrowserSurfaceIpcRouter(managerFake() as never)

    await expect(router.handle('task_browser_surface_get_or_create', {}, null)).resolves.toMatchObject({
      ok: false,
      error: { code: 'HOST_UNAVAILABLE' },
    })
    await expect(router.handle('task_browser_surface_attach', { surfaceId: 'surface-1', attachmentId: 'a', bounds: { x: 0 } }, 10)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_BOUNDS' },
    })
  })
})
