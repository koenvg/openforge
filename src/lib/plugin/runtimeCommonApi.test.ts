import { describe, expect, it, vi } from 'vitest'
import { RuntimeCommonApiRegistry } from './runtimeCommonApi'
import { RuntimeRegistryServices } from './runtimeContributionSupport'

describe('RuntimeCommonApiRegistry', () => {
  it('owns command and event contributions shared by frontend and backend APIs', async () => {
    const services = new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const registry = new RuntimeCommonApiRegistry(services)
    const api = registry.createApi()
    const listener = vi.fn()

    const command = api.commands.register({
      id: 'sync',
      title: 'Sync pull requests',
      handler: async (payload) => ({ payload }),
    })
    const event = api.events.on('sync.finished', listener)

    await expect(api.commands.invoke('sync', { force: true })).resolves.toEqual({ payload: { force: true } })
    await api.events.emit('sync.finished', { count: 2 })

    expect(listener).toHaveBeenCalledWith({ count: 2 })
    expect(registry.getSnapshot()).toMatchObject({
      commands: [{ qualifiedId: 'github.sync' }],
      eventListeners: [{ qualifiedId: 'github.sync.finished' }],
    })

    await event.dispose()
    await command.dispose()
  })
  it('forwards Task Agent Session history requests through the runtime host', async () => {
    const sessions = [{ id: 'S-1', ticket_id: 'T-1', provider: 'pi', created_at: 200 }] as never
    const listTaskSessions = vi.fn().mockResolvedValue(sessions)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'usage',
      projectId: null,
      host: { listTaskSessions },
    }))
    const api = registry.createApi()
    const request = { taskId: 'T-1', provider: 'pi', createdAtOrAfter: 150 }

    await expect(api.tasks.listSessions(request)).resolves.toEqual(sessions)
    expect(listTaskSessions).toHaveBeenCalledWith(request)
  })

  it('forwards Task usage candidate requests through the runtime host', async () => {
    const page = { items: [], nextCursor: null }
    const listTaskUsageCandidates = vi.fn().mockResolvedValue(page)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'usage',
      projectId: null,
      host: { listTaskUsageCandidates },
    }))
    const request = { provider: 'pi', periodStart: 300, taskId: 'T-1', pageSize: 100 }

    await expect(registry.createApi().tasks.listUsageCandidates(request)).resolves.toEqual(page)
    expect(listTaskUsageCandidates).toHaveBeenCalledWith(request)
  })


  it('creates isolated capability facades over shared registry state', () => {
    const registry = new RuntimeCommonApiRegistry(
      new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1' }),
    )

    const frontendCommonApi = registry.createApi()
    const backendCommonApi = registry.createApi()

    expect(frontendCommonApi).not.toBe(backendCommonApi)
    expect(frontendCommonApi.commands).not.toBe(backendCommonApi.commands)
    expect(frontendCommonApi.events).not.toBe(backendCommonApi.events)
    expect(frontendCommonApi.tasks).not.toBe(backendCommonApi.tasks)
  })
})
