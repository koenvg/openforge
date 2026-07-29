import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import type { TaskBrowserSurfaceState } from '@openforge-app/plugin-sdk/frontend'
import { describe, expect, it, vi } from 'vitest'
import { createTaskBrowserLinkHandler } from './taskLinkHandler'

describe('Task Browser link handler', () => {
  it('declines unsupported URLs without creating a Browser Surface', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const handler = createTaskBrowserLinkHandler(api)

    await expect(handler({ taskId: 'T-1', url: 'file:///tmp/secret' })).resolves.toBe('declined')
    expect(api.__testing.calls.browserSurfaceGetOrCreate).toEqual([])
  })

  it('does not persist or foreground a failed navigation', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-1', id: 'main' })
    const failedState: TaskBrowserSurfaceState = {
      url: 'https://unreachable.invalid/',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: {
        code: 'ERR_NAME_NOT_RESOLVED',
        message: 'Name not resolved',
        url: 'https://unreachable.invalid/',
      },
    }
    vi.spyOn(surface, 'navigate').mockResolvedValue(failedState)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    const handler = createTaskBrowserLinkHandler(api)

    await expect(handler({ taskId: 'T-1', url: failedState.url })).rejects.toThrow('Name not resolved')
    await expect(api.storage.task('T-1').get('lastBrowserUrl')).resolves.toBeNull()
    expect(api.__testing.calls.navigationRequests).toEqual([])
  })
})
