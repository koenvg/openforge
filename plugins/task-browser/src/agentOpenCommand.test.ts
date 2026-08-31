import type { PluginCommandInvocationContext } from '@openforge-app/plugin-sdk'
import type { TaskBrowserSurfaceState } from '@openforge-app/plugin-sdk/frontend'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createBrowserTabSession } from './browserTabSession'
import plugin from './index'

const agentContext = (taskId: string | null): PluginCommandInvocationContext => ({
  taskId,
  projectId: 'P-1',
  source: 'agent-cli',
})

async function activateTaskBrowser() {
  const registry = createOpenForgeRegistryFake({
    pluginId: 'com.openforge.task-browser',
    projectId: 'P-1',
  })
  await registry.activateFrontend(plugin)
  const command = registry.snapshot.commands.find(({ id }) => id === 'open')
  if (!command) throw new Error('Task Browser open command was not registered')
  return { registry, command }
}

describe('Task Browser agent open command', () => {
  it('registers stable agent guidance and accepts detached loading navigation for the invocation Task', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-1', id: 'main' })
    const loadingState: TaskBrowserSurfaceState = {
      url: 'http://localhost:5173/ready',
      title: '',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    }
    vi.spyOn(surface, 'navigate').mockResolvedValue(loadingState)
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    expect(command).toMatchObject({
      qualifiedId: 'com.openforge.task-browser.open',
      discoverable: false,
      agent: {
        discoverable: true,
        description: expect.stringContaining('verified'),
        examples: [{ url: 'http://localhost:5173/ready' }],
      },
      input: {
        type: 'object',
        required: ['url'],
        additionalProperties: false,
        properties: {
          url: expect.objectContaining({
            type: 'string',
            format: 'uri',
            pattern: '^[Hh][Tt][Tt][Pp][Ss]?://',
          }),
        },
      },
    })

    await expect(command.handler({ url: loadingState.url }, agentContext('T-1'))).resolves.toEqual({ accepted: true })
    expect(surface.navigate).toHaveBeenCalledWith(loadingState.url)
    expect(registry.calls.browserSurfaceGetOrCreate).toContainEqual({ taskId: 'T-1', id: 'main' })
    expect(registry.calls.browserSurfaceAttachments).toEqual([])
    expect(registry.calls.navigationRequests).toEqual([])
    expect(registry.calls.openUrl).toEqual([])
  })

  it('persists the first successful settled redirect after returning from accepted navigation', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-redirect', id: 'main' })
    const loadingState: TaskBrowserSurfaceState = {
      url: 'http://localhost:5173/start',
      title: '',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: null,
    }
    vi.spyOn(surface, 'navigate').mockResolvedValue(loadingState)
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await expect(command.handler({ url: loadingState.url }, agentContext('T-redirect'))).resolves.toEqual({ accepted: true })
    await expect(registry.frontendApi.storage.task('T-redirect').get('lastBrowserUrl')).resolves.toBeNull()

    registry.setBrowserSurfaceState('T-redirect', 'main', {
      url: 'http://localhost:5173/final',
      loading: false,
      error: null,
    })

    await vi.waitFor(async () => {
      await expect(registry.frontendApi.storage.task('T-redirect').get('lastBrowserUrl'))
        .resolves.toBe('http://localhost:5173/final')
    })

    registry.setBrowserSurfaceState('T-redirect', 'main', {
      url: 'http://localhost:5173/later',
      loading: false,
      error: null,
    })
    await expect(registry.frontendApi.storage.task('T-redirect').get('lastBrowserUrl'))
      .resolves.toBe('http://localhost:5173/final')
  })

  it.each([
    ['missing Task context', { url: 'https://openforge.dev' }, agentContext(null), 'INVALID_TASK'],
    ['empty input', { url: '' }, agentContext('T-invalid'), 'INVALID_URL'],
    ['malformed input', { url: 'not a URL' }, agentContext('T-invalid'), 'INVALID_URL'],
    ['non-HTTP input', { url: 'file:///tmp/secret' }, agentContext('T-invalid'), 'INVALID_URL'],
    ['additional input', { url: 'https://openforge.dev', unexpected: true }, agentContext('T-invalid'), 'INVALID_URL'],
  ])('rejects %s without creating a surface', async (_label, input, context, code) => {
    const { registry, command } = await activateTaskBrowser()

    await expect(command.handler(input, context)).rejects.toMatchObject({ code })
    expect(registry.calls.browserSurfaceGetOrCreate).toEqual([])
  })

  it('fails an immediate navigation error and disposes its observer without exposing error details', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-failed', id: 'main' })
    const originalSubscribe = surface.onStateChanged.bind(surface)
    const observerDispose = vi.fn()
    vi.spyOn(surface, 'onStateChanged').mockImplementation((handler) => {
      const subscription = originalSubscribe(handler)
      return {
        async dispose() {
          observerDispose()
          await subscription.dispose()
        },
      }
    })
    vi.spyOn(surface, 'navigate').mockResolvedValue({
      url: 'https://user:secret@unreachable.invalid/',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      error: {
        code: 'ERR_NAME_NOT_RESOLVED',
        message: 'Could not load https://user:secret@unreachable.invalid/',
        url: 'https://user:secret@unreachable.invalid/',
      },
    })
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await expect(command.handler(
      { url: 'https://user:secret@unreachable.invalid/' },
      agentContext('T-failed'),
    )).rejects.toThrow('Task Browser navigation was rejected')
    expect(observerDispose).toHaveBeenCalledOnce()
    await expect(registry.frontendApi.storage.task('T-failed').get('lastBrowserUrl')).resolves.toBeNull()
  })

  it('supersedes the command observer when the user starts newer Task Browser navigation', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-user', id: 'main' })
    const originalSubscribe = surface.onStateChanged.bind(surface)
    const commandObserverDispose = vi.fn()
    let subscriptionCount = 0
    vi.spyOn(surface, 'onStateChanged').mockImplementation((handler) => {
      const subscription = originalSubscribe(handler)
      subscriptionCount += 1
      if (subscriptionCount !== 1) return subscription
      return {
        async dispose() {
          commandObserverDispose()
          await subscription.dispose()
        },
      }
    })
    const originalNavigate = surface.navigate.bind(surface)
    vi.spyOn(surface, 'navigate')
      .mockResolvedValueOnce({
        url: 'http://localhost:5173/agent',
        title: '',
        loading: true,
        canGoBack: false,
        canGoForward: false,
        devToolsOpen: false,
        error: null,
      })
      .mockImplementation(url => originalNavigate(url))
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await command.handler({ url: 'http://localhost:5173/agent' }, agentContext('T-user'))
    const session = await createBrowserTabSession({
      api: registry.frontendApi,
      taskId: 'T-user',
      element: {} as HTMLElement,
      onStateChanged: vi.fn(),
    })

    await session.navigate('http://localhost:5173/user')

    expect(commandObserverDispose).toHaveBeenCalledOnce()
    await session.dispose()
  })

  it('disposes without persisting when loading settles in a terminal error', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-terminal', id: 'main' })
    const originalSubscribe = surface.onStateChanged.bind(surface)
    const observerDispose = vi.fn()
    vi.spyOn(surface, 'onStateChanged').mockImplementation((handler) => {
      const subscription = originalSubscribe(handler)
      return { dispose: async () => { observerDispose(); await subscription.dispose() } }
    })
    vi.spyOn(surface, 'navigate').mockResolvedValue({
      url: 'https://terminal.invalid/', title: '', loading: true,
      canGoBack: false, canGoForward: false, error: null,
      devToolsOpen: false,
    })
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await command.handler({ url: 'https://terminal.invalid/' }, agentContext('T-terminal'))
    registry.setBrowserSurfaceState('T-terminal', 'main', {
      loading: false,
      error: { code: 'ERR_FAILED', message: 'Failed', url: 'https://terminal.invalid/' },
    })

    await vi.waitFor(() => expect(observerDispose).toHaveBeenCalledOnce())
    await expect(registry.frontendApi.storage.task('T-terminal').get('lastBrowserUrl')).resolves.toBeNull()
  })

  it('disposes a loading observer when the plugin deactivates', async () => {
    const { registry, command } = await activateTaskBrowser()
    const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-deactivate', id: 'main' })
    const originalSubscribe = surface.onStateChanged.bind(surface)
    const observerDispose = vi.fn()
    vi.spyOn(surface, 'onStateChanged').mockImplementation((handler) => {
      const subscription = originalSubscribe(handler)
      return { dispose: async () => { observerDispose(); await subscription.dispose() } }
    })
    vi.spyOn(surface, 'navigate').mockResolvedValue({
      url: 'https://loading.example/', title: '', loading: true,
      canGoBack: false, canGoForward: false, error: null,
      devToolsOpen: false,
    })
    vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    await command.handler({ url: 'https://loading.example/' }, agentContext('T-deactivate'))
    await registry.disposeAll()

    expect(observerDispose).toHaveBeenCalledOnce()
  })

  it('expires a loading observer after a bounded lifetime', async () => {
    vi.useFakeTimers()
    try {
      const { registry, command } = await activateTaskBrowser()
      const surface = await registry.frontendApi.browserSurfaces.getOrCreate({ taskId: 'T-expiry', id: 'main' })
      const originalSubscribe = surface.onStateChanged.bind(surface)
      const observerDispose = vi.fn()
      vi.spyOn(surface, 'onStateChanged').mockImplementation((handler) => {
        const subscription = originalSubscribe(handler)
        return { dispose: async () => { observerDispose(); await subscription.dispose() } }
      })
      vi.spyOn(surface, 'navigate').mockResolvedValue({
        url: 'https://loading.example/', title: '', loading: true,
        canGoBack: false, canGoForward: false, error: null,
        devToolsOpen: false,
      })
      vi.spyOn(registry.frontendApi.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

      await command.handler({ url: 'https://loading.example/' }, agentContext('T-expiry'))
      await vi.advanceTimersByTimeAsync(30_000)

      expect(observerDispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
