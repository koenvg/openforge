import { BrowserSurfaceError, type TaskBrowserSurfaceState } from '@openforge-app/plugin-sdk/frontend'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserTabSession,
  normalizeBrowserAddress,
  persistSuccessfulBrowserState,
} from './browserTabSession'
import { getBrowserNavigationCoordinator } from './browserNavigationCoordinator'

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

  it('starts on the host-controlled blank page when the Task has no saved URL', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-2',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    expect(api.__testing.calls.browserSurfaceGetOrCreate[0]).toEqual({
      taskId: 'T-2',
      id: 'main',
    })
    await session.dispose()
  })

  it('persists a settled surface state observed when the foregrounded tab attaches', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-link', id: 'main' })
    vi.spyOn(surface, 'getState').mockResolvedValue({
      url: 'http://localhost:6382/',
      title: 'Local app',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    const session = await createBrowserTabSession({
      api,
      taskId: 'T-link',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })
    await session.dispose()

    await expect(api.storage.task('T-link').get('lastBrowserUrl')).resolves.toBe('http://localhost:6382/')
  })

  it('does not restore the legacy network-dependent default URL', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    await api.storage.task('T-legacy').set('lastBrowserUrl', 'https://example.com/')

    const session = await createBrowserTabSession({
      api,
      taskId: 'T-legacy',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    expect(api.__testing.calls.browserSurfaceGetOrCreate[0]).toEqual({
      taskId: 'T-legacy',
      id: 'main',
    })
    await expect(api.storage.task('T-legacy').get('lastBrowserUrl')).resolves.toBeNull()
    await session.dispose()
  })

  it('does not persist a URL when navigation is explicitly stopped', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-loading', id: 'main' })
    let resolveStop!: (state: TaskBrowserSurfaceState) => void
    const stopResult = new Promise<TaskBrowserSurfaceState>((resolve) => { resolveStop = resolve })
    vi.spyOn(surface, 'stop').mockReturnValue(stopResult)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-loading',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    api.__testing.registry.setBrowserSurfaceState('T-loading', 'main', {
      url: 'https://offline.example/',
      loading: true,
      error: null,
    })
    const stopping = session.stop()
    api.__testing.registry.setBrowserSurfaceState('T-loading', 'main', {
      title: 'Late loading state',
      loading: true,
    })
    api.__testing.registry.setBrowserSurfaceState('T-loading', 'main', {
      url: 'https://redirected-offline.example/',
      loading: false,
      error: null,
    })
    resolveStop(await surface.getState())
    await stopping
    api.__testing.registry.setBrowserSurfaceState('T-loading', 'main', {
      loading: false,
    })
    await session.dispose()

    await expect(api.storage.task('T-loading').get('lastBrowserUrl')).resolves.toBeNull()
  })

  it('resumes URL persistence when a new navigation starts after a stop', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-retry',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    api.__testing.registry.setBrowserSurfaceState('T-retry', 'main', {
      url: 'https://stopped.example/',
      loading: true,
      error: null,
    })
    await session.stop()
    api.__testing.registry.setBrowserSurfaceState('T-retry', 'main', {
      url: 'https://retry.example/',
      loading: true,
      error: null,
    })
    api.__testing.registry.setBrowserSurfaceState('T-retry', 'main', {
      loading: false,
    })
    await session.dispose()

    await expect(api.storage.task('T-retry').get('lastBrowserUrl')).resolves.toBe('https://retry.example/')
  })

  it('restores persistence when stopping the navigation fails', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-stop-failed', id: 'main' })
    vi.spyOn(surface, 'stop').mockRejectedValue(new Error('stop failed'))
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    const session = await createBrowserTabSession({
      api,
      taskId: 'T-stop-failed',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    api.__testing.registry.setBrowserSurfaceState('T-stop-failed', 'main', {
      url: 'https://eventually-loaded.example/',
      loading: true,
      error: null,
    })
    await expect(session.stop()).rejects.toThrow('stop failed')
    api.__testing.registry.setBrowserSurfaceState('T-stop-failed', 'main', {
      loading: false,
    })
    await session.dispose()

    await expect(api.storage.task('T-stop-failed').get('lastBrowserUrl')).resolves.toBe('https://eventually-loaded.example/')
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

  it('does not complete an older persistence write after newer navigation begins', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const storage = api.storage.task('T-race')
    vi.spyOn(api.storage, 'task').mockReturnValue(storage)
    let markSetStarted!: () => void
    const setStarted = new Promise<void>((resolve) => { markSetStarted = resolve })
    let releaseSet!: () => void
    const setReleased = new Promise<void>((resolve) => { releaseSet = resolve })
    vi.spyOn(storage, 'set').mockImplementation(async () => {
      markSetStarted()
      await setReleased
    })

    const persistence = persistSuccessfulBrowserState(api, 'T-race', {
      url: 'https://older.example/',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    })
    await setStarted
    getBrowserNavigationCoordinator(api).begin('T-race')
    releaseSet()

    await expect(persistence).resolves.toBe(false)
  })
})
