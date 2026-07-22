import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_BROWSER_URL,
  createBrowserTabSession,
  normalizeBrowserAddress,
} from './browserTabSession'

describe('Task browser tab session', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['https://openforge.dev/docs', 'https://openforge.dev/docs'],
    [' http://localhost:3000/path ', 'http://localhost:3000/path'],
  ])('normalizes %s to an allowed browser URL', (input, expected) => {
    expect(normalizeBrowserAddress(input)).toBe(expected)
  })

  it.each(['', 'file:///tmp/secret', 'javascript:alert(1)', 'not a valid host'])('rejects invalid address %s', (input) => {
    expect(() => normalizeBrowserAddress(input)).toThrowError(BrowserSurfaceError)
    try {
      normalizeBrowserAddress(input)
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_URL' })
    }
  })

  it('restores the Task URL, attaches the surface, publishes state, and cleans up without destroying it', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    await api.storage.task('T-1').set('lastBrowserUrl', 'https://example.com/saved')
    const element = {} as HTMLElement
    const onStateChanged = vi.fn()

    const session = await createBrowserTabSession({ api, taskId: 'T-1', element, onStateChanged })

    expect(api.__testing.calls.browserSurfaceGetOrCreate).toEqual([{
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/saved',
    }])
    expect(api.__testing.calls.browserSurfaceAttachments).toHaveLength(1)
    expect(onStateChanged).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/saved' }))

    const navigated = await session.navigate('openforge.dev')
    expect(navigated.url).toBe('https://openforge.dev/')
    await vi.waitFor(async () => {
      await expect(api.storage.task('T-1').get('lastBrowserUrl')).resolves.toBe('https://openforge.dev/')
    })

    await session.dispose()
    expect(api.__testing.calls.browserSurfaceDetaches).toEqual([{ taskId: 'T-1', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceDestroys).toEqual([])
  })

  it('uses a visible smoke-test page when the Task has no saved URL', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-2',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    expect(api.__testing.calls.browserSurfaceGetOrCreate[0]).toMatchObject({ initialUrl: DEFAULT_BROWSER_URL })
    await session.dispose()
  })

  it('releases a state subscription when attachment fails', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-3', id: 'main' })
    const subscriptionDispose = vi.fn()
    vi.spyOn(surface, 'onStateChanged').mockReturnValue({ dispose: subscriptionDispose })
    vi.spyOn(surface, 'attach').mockRejectedValue(new Error('attach failed'))
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await expect(createBrowserTabSession({
      api,
      taskId: 'T-3',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })).rejects.toThrow('attach failed')
    expect(subscriptionDispose).toHaveBeenCalledTimes(1)
  })

  it('detaches and unsubscribes when initial state loading fails after attachment', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-4', id: 'main' })
    const attachmentDispose = vi.fn()
    const subscriptionDispose = vi.fn()
    vi.spyOn(surface, 'onStateChanged').mockReturnValue({ dispose: subscriptionDispose })
    vi.spyOn(surface, 'attach').mockResolvedValue({ dispose: attachmentDispose })
    vi.spyOn(surface, 'getState').mockRejectedValue(new Error('state failed'))
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await expect(createBrowserTabSession({
      api,
      taskId: 'T-4',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })).rejects.toThrow('state failed')
    expect(attachmentDispose).toHaveBeenCalledTimes(1)
    expect(subscriptionDispose).toHaveBeenCalledTimes(1)
  })

  it('contains URL persistence failures and still disposes cleanly', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const storage = api.storage.task('T-5')
    vi.spyOn(api.storage, 'task').mockReturnValue(storage)
    vi.spyOn(storage, 'set').mockRejectedValue(new Error('storage unavailable'))
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-5',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    api.__testing.registry.setBrowserSurfaceState('T-5', 'main', { url: 'https://saved.example/' })
    await expect(session.dispose()).resolves.toBeUndefined()
  })
})
