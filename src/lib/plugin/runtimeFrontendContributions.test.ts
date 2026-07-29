import { describe, expect, it, vi } from 'vitest'
import { RuntimeContributionClaims, RuntimeRegistryServices } from './runtimeContributionSupport'
import { RuntimeFrontendContributionRegistry } from './runtimeFrontendContributions'

const PluginView = (() => undefined) as never

describe('RuntimeFrontendContributionRegistry', () => {
  it('owns visual contribution registration and disposal independently', async () => {
    const claims = new RuntimeContributionClaims()
    const services = new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1', claims })
    const registry = new RuntimeFrontendContributionRegistry(services, async () => undefined)
    const api = registry.createApi()

    const disposable = api.views.register({
      id: 'pull-requests',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      component: PluginView,
    })

    expect(registry.getSnapshot().views).toMatchObject([
      { id: 'pull-requests', qualifiedId: 'github.pull-requests', projectId: 'project-1' },
    ])

    await disposable.dispose()

    expect(registry.getSnapshot().views).toEqual([])
    expect(claims.has('views', 'github.pull-requests')).toBe(false)
  })

  it('adapts the frontend Task links capability to the host with plugin-owned registration cleanup', async () => {
    const handlerRegistration = { dispose: vi.fn() }
    const openTaskLink = vi.fn(async () => undefined)
    const registerTaskLinkHandler = vi.fn(() => handlerRegistration)
    const services = new RuntimeRegistryServices({
      pluginId: 'com.openforge.task-browser',
      projectId: 'project-1',
      host: { openTaskLink, registerTaskLinkHandler },
    })
    const registry = new RuntimeFrontendContributionRegistry(services, async () => undefined)
    const api = registry.createApi()
    const request = { taskId: 'T-1', url: 'https://openforge.dev/docs' }
    const handler = vi.fn(async () => 'handled' as const)

    await api.taskLinks.open(request)
    const registration = api.taskLinks.registerHandler(handler)

    expect(openTaskLink).toHaveBeenCalledWith(request)
    expect(registerTaskLinkHandler).toHaveBeenCalledWith('com.openforge.task-browser', handler)

    await registration.dispose()
    expect(handlerRegistration.dispose).toHaveBeenCalledOnce()
  })
})
