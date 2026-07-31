import { describe, expect, it, vi } from 'vitest'

import { createTaskBrowserSurfaceManagerFixture } from './taskBrowserSurfaceManager.testUtils'

describe('Task Browser Surface permission cleanup lifecycle', () => {
  it('keeps the reset barrier until every cleanup settles even when one cleanup fails', async () => {
    const { factory, manager, permissions } = createTaskBrowserSurfaceManagerFixture()
    factory.clearError = new Error('site data clear failed')
    let releasePermissionClear: (() => void) | null = null
    permissions.clearSession.mockImplementation(() => new Promise<void>(resolve => { releasePermissionClear = resolve }))
    await manager.getOrCreate({ windowId: 10, pluginId: 'browser', taskId: 'T-reset-failure', id: 'main' })

    const resetResult = manager.resetSession('browser').then(() => null, error => error)
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
