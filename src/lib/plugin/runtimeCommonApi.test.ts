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

  it('forwards typed project Task subscriptions through the runtime host', async () => {
    const dispose = vi.fn()
    let hostHandler: ((event: {
      projectId: string
      taskId: string | null
      reason: 'created' | 'updated' | 'completed' | 'attention' | 'execution'
    }) => void) | null = null
    const subscribeTaskChanges = vi.fn((_projectId, handler) => {
      hostHandler = handler
      return { dispose }
    })
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'dashboard',
      projectId: 'P-1',
      host: { subscribeTaskChanges },
    }))
    const handler = vi.fn()

    const subscription = registry.createApi().tasks.onDidChange('P-1', handler)
    const observedHostHandler = hostHandler as ((event: {
      projectId: string
      taskId: string | null
      reason: 'created' | 'updated' | 'completed' | 'attention' | 'execution'
    }) => void) | null
    observedHostHandler?.({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    expect(subscribeTaskChanges).toHaveBeenCalledWith('P-1', expect.any(Function))
    expect(handler).toHaveBeenCalledWith({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    await subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('forwards Agent Session page requests through the frontend runtime host', async () => {
    const page = {
      items: [{
        id: 'S-1', provider: 'pi', providerSessionId: 'pi-S-1', createdAt: 100, updatedAt: 200,
        task: { id: 'T-1', title: 'Import history', status: 'doing', createdAt: 50, updatedAt: 250 },
        workspace: { rootPath: '/repo', kind: 'project' },
      }],
      nextCursor: null,
    }
    const listAgentSessions = vi.fn().mockResolvedValue(page)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'usage',
      projectId: null,
      host: { listAgentSessions },
    }))
    const request = {
      provider: 'pi',
      overlaps: { startInclusive: 100, endExclusive: 300 },
      taskId: 'T-1',
      pageSize: 100,
    }

    await expect(registry.createApi().agentSessions.list(request)).resolves.toEqual(page)
    expect(listAgentSessions).toHaveBeenCalledWith(request)
  })

  it('warns once per activation while preserving every legacy Task list result', async () => {
    const legacyTasks = [{ id: 'T-1' }, { id: 'T-2' }] as never
    const listTasks = vi.fn().mockResolvedValue(legacyTasks)
    const getTask = vi.fn().mockResolvedValue(legacyTasks[0])
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'legacy-plugin',
      projectId: null,
      host: { listTasks, getTask },
    }))
    const api = registry.createApi()

    await expect(api.tasks.list()).resolves.toBe(legacyTasks)
    await expect(api.tasks.list({ projectId: 'P-1', includeDone: true })).resolves.toBe(legacyTasks)
    await expect(api.tasks.get('T-1')).resolves.toBe(legacyTasks[0])

    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('tasks.list() and tasks.get() are deprecated'))
    warning.mockRestore()
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
