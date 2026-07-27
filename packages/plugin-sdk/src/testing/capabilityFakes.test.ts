import { describe, expect, it, vi } from 'vitest'
import { TestingBackendServicesFake } from './backendServicesFake'
import { TestingFrontendContributionFake } from './frontendContributionFake'
import { TestingRegistryServices } from './support'

const PluginView = (() => undefined) as never

describe('testing capability fakes', () => {
  it('keeps frontend contribution state separate from backend service state', async () => {
    const services = new TestingRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const backend = new TestingBackendServicesFake(services)
    const frontend = new TestingFrontendContributionFake(services, (method, payload) => backend.invokeMethod(method, payload))
    const frontendApi = frontend.createApi()
    const backendApi = backend.createApi()
    const start = vi.fn()

    frontendApi.views.register({
      id: 'pull-requests',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      component: PluginView,
    })
    backendApi.backend.registerMethod('sync', { handler: async () => 'synced' })
    backendApi.background.register({ id: 'poller', scope: 'project', start })

    await backend.startNewBackgroundServices(new Set())

    expect(frontend.getSnapshot().views).toMatchObject([{ qualifiedId: 'github.pull-requests' }])
    expect(backend.getSnapshot()).toMatchObject({
      backendMethods: [{ qualifiedId: 'github.sync' }],
      backgroundServices: [{ qualifiedId: 'github.poller', started: true }],
    })
    await expect(frontendApi.backend.invoke('sync')).resolves.toBe('synced')
    expect(start).toHaveBeenCalledOnce()
  })
})
