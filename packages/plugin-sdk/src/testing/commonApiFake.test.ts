import { describe, expect, it, vi } from 'vitest'
import { TestingCommonApiFake } from './commonApiFake'
import { TestingRegistryServices } from './support'

describe('TestingCommonApiFake', () => {
  it('owns shared command, event, and host capability fakes', async () => {
    const services = new TestingRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const fake = new TestingCommonApiFake(services)
    const api = fake.createApi()
    const listener = vi.fn()
    const handler = vi.fn(async () => 'ok')

    api.commands.register({ id: 'sync', title: 'Sync', handler })
    api.events.on('sync.finished', listener)

    await expect(api.commands.invoke('sync')).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledWith(undefined, {
      taskId: null,
      projectId: 'project-1',
      source: 'plugin',
    })
    await api.events.emit('sync.finished', { count: 1 })
    await api.system.openUrl('https://openforge.dev')

    expect(listener).toHaveBeenCalledWith({ count: 1 })
    expect(services.calls.openUrl).toEqual(['https://openforge.dev'])
    expect(fake.getSnapshot()).toMatchObject({
      commands: [{ qualifiedId: 'github.sync' }],
      eventListeners: [{ qualifiedId: 'github.sync.finished' }],
    })
  })

  it('creates isolated capability facades over shared fake state', () => {
    const fake = new TestingCommonApiFake(
      new TestingRegistryServices({ pluginId: 'github', projectId: 'project-1' }),
    )

    const frontendCommonApi = fake.createApi()
    const backendCommonApi = fake.createApi()

    expect(frontendCommonApi).not.toBe(backendCommonApi)
    expect(frontendCommonApi.commands).not.toBe(backendCommonApi.commands)
    expect(frontendCommonApi.events).not.toBe(backendCommonApi.events)
    expect(frontendCommonApi.tasks).not.toBe(backendCommonApi.tasks)
  })
})
