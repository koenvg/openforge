import { describe, expect, it, vi } from 'vitest'
import { RuntimeBackendServices } from './runtimeBackendServices'
import { RuntimeRegistryServices } from './runtimeContributionSupport'

describe('RuntimeBackendServices', () => {
  it('owns backend methods and background service lifecycle', async () => {
    const services = new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const registry = new RuntimeBackendServices(services)
    const api = registry.createApi()
    const start = vi.fn()
    const stop = vi.fn()

    api.backend.registerMethod('sync', { handler: async (payload) => ({ payload }) })
    const service = api.background.register({ id: 'poller', scope: 'project', start, stop })

    await registry.startNewBackgroundServices(new Set())

    await expect(registry.invokeMethod('sync', { force: true })).resolves.toEqual({ payload: { force: true } })
    expect(start).toHaveBeenCalledOnce()
    expect(registry.getSnapshot().backgroundServices[0]?.started).toBe(true)

    await service.dispose()

    expect(stop).toHaveBeenCalledOnce()
    expect(registry.getSnapshot().backgroundServices).toEqual([])
  })
})
