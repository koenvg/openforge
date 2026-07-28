import { describe, expect, it, vi } from 'vitest'

import { TaskBrowserSurfaceManager } from './taskBrowserSurfaceManager'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserNativeState,
  TaskBrowserSurfaceCreateOptions,
} from './taskBrowserSurfaceManager'
import type { TaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry'
import type { TaskBrowserPermissionController } from './taskBrowserSurfaceManager'

const BLANK_STATE: TaskBrowserNativeState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
}

function nativeSurface(): NativeTaskBrowserSurface {
  return {
    getState: () => ({ ...BLANK_STATE }),
    onStateChanged: () => () => undefined,
    loadURL: async () => undefined,
    attach: () => undefined,
    detach: () => undefined,
    destroy: () => undefined,
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    stop: () => undefined,
  }
}

class CleanupFactory implements NativeTaskBrowserSurfaceFactory {
  readonly creations: TaskBrowserSurfaceCreateOptions[] = []
  readonly clearSession = vi.fn(async () => { throw new Error('site data clear failed') })

  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface {
    this.creations.push(options)
    return nativeSurface()
  }
}

const registry: TaskBrowserPartitionRegistry = {
  register: async () => undefined,
  listByTask: async () => [],
  listByPlugin: async () => [],
  remove: async () => undefined,
}

describe('Task Browser Surface permission cleanup lifecycle', () => {
  it('keeps the reset barrier until every cleanup settles even when one cleanup fails', async () => {
    const factory = new CleanupFactory()
    let releasePermissionClear: (() => void) | null = null
    const permissions: TaskBrowserPermissionController = {
      createSessionHandler: async () => ({ check: () => false, request: async () => false }),
      clearSession: vi.fn(() => new Promise<void>(resolve => { releasePermissionClear = resolve })),
    }
    const manager = new TaskBrowserSurfaceManager({
      factory,
      registry,
      permissions,
      authorize: async () => undefined,
    })
    manager.registerWindow(10, { x: 0, y: 0, width: 800, height: 600 })
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-failure', id: 'main' })

    const resetResult = manager.resetSession('browser', 'T-reset-failure').then(() => null, error => error)
    await vi.waitFor(() => expect(permissions.clearSession).toHaveBeenCalled())
    const reacquire = manager.getOrCreate({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-reset-failure',
      id: 'main',
    })
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    expect(factory.creations).toHaveLength(1)

    releasePermissionClear!()
    await expect(resetResult).resolves.toEqual(expect.objectContaining({ message: 'site data clear failed' }))
    await expect(reacquire).resolves.toBeDefined()
    expect(factory.creations).toHaveLength(2)
  })
})
