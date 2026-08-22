import { describe, expect, it, vi } from 'vitest'
import { TestingBackendServicesFake } from './backendServicesFake'
import { createMockBackendOpenForgeApi } from '../testing'
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

  it('records backend user data and external filesystem calls', async () => {
    const api = createMockBackendOpenForgeApi({ pluginId: 'skill-usage' })

    await api.fs.userData.readDir({ path: 'telemetry' })
    await api.fs.userData.readTextFile({ path: 'telemetry/usage.json' })
    await api.fs.userData.writeTextFile({ path: 'telemetry/usage.json', content: '{"runs":1}' })
    await api.fs.external.readDir({ root: '/Users/test/.pi/agent/sessions', path: '2026' })
    await api.fs.external.readTextFile({ root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' })

    expect(api.__testing.calls.fsUserDataReadDirs).toEqual([{ path: 'telemetry' }])
    expect(api.__testing.calls.fsUserDataReads).toEqual([{ path: 'telemetry/usage.json' }])
    expect(api.__testing.calls.fsUserDataWrites).toEqual([{ path: 'telemetry/usage.json', content: '{"runs":1}' }])
    expect(api.__testing.calls.fsExternalReadDirs).toEqual([{ root: '/Users/test/.pi/agent/sessions', path: '2026' }])
    expect(api.__testing.calls.fsExternalReads).toEqual([{ root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' }])
  })
})
