import { describe, expect, it, vi } from 'vitest'

import { createTaskBrowserSurfaceAuthorizer } from './taskBrowserSurfaceAuthorization'

describe('Task Browser Surface ownership authorization', () => {
  it('requires an existing project-owned Task and project plugin enablement', async () => {
    const invoke = vi.fn(async (command: string) => command === 'get_task_detail'
      ? { id: 'T-1', project_id: 'P-1', status: 'doing' }
      : [{ id: 'browser' }])
    const authorize = createTaskBrowserSurfaceAuthorizer(invoke)

    await expect(authorize('browser', 'T-1')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_task_detail', { taskId: 'T-1' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_enabled_plugins', { projectId: 'P-1' })
  })

  it('returns named invalid Task, disabled plugin, and unavailable host failures', async () => {
    await expect(createTaskBrowserSurfaceAuthorizer(async () => ({ id: 'T-1', project_id: null }))('browser', 'T-1'))
      .rejects.toMatchObject({ code: 'INVALID_TASK' })

    await expect(createTaskBrowserSurfaceAuthorizer(async () => ({
      id: 'T-1',
      project_id: 'P-1',
      status: 'done',
    }))('browser', 'T-1')).rejects.toMatchObject({ code: 'INVALID_TASK' })

    const disabled = createTaskBrowserSurfaceAuthorizer(async command => command === 'get_task_detail'
      ? { id: 'T-1', project_id: 'P-1', status: 'doing' }
      : [])
    await expect(disabled('browser', 'T-1')).rejects.toMatchObject({ code: 'PLUGIN_NOT_ENABLED' })

    const unavailable = createTaskBrowserSurfaceAuthorizer(async () => { throw new Error('Rust sidecar is not available') })
    await expect(unavailable('browser', 'T-1')).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' })
  })
})
