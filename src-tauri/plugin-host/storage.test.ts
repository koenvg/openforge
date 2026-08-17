import { describe, expect, it, vi } from 'vitest'
import { createHostStorage, createMemoryStorage } from './storage'

describe('plugin-host storage', () => {
  it('isolates in-memory values by storage scope and scope id', async () => {
    const storage = createMemoryStorage()

    await storage.global.set('key', 'global')
    await storage.project('P-1').set('key', 'project-1')
    await storage.project('P-2').set('key', 'project-2')
    await storage.task('T-1').set('key', 'task-1')

    await expect(storage.global.get('key')).resolves.toBe('global')
    await expect(storage.project('P-1').get('key')).resolves.toBe('project-1')
    await expect(storage.project('P-2').get('key')).resolves.toBe('project-2')
    await expect(storage.task('T-1').get('key')).resolves.toBe('task-1')
    await expect(storage.task('T-2').get('key')).resolves.toBeNull()
  })

  it('attributes durable storage callbacks to the plugin and selected scope', async () => {
    const hostCallbacks = vi.fn(async request => request.method === 'openforge.storage.get' ? 'stored' : null)
    const storage = createHostStorage('scheduler', hostCallbacks)

    await expect(storage.project('P-1').get('settings')).resolves.toBe('stored')
    await storage.task('T-1').set('cursor', { page: 2 })
    await storage.global.delete('legacy')

    expect(hostCallbacks.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'openforge.storage.get',
        params: { pluginId: 'scheduler', scope: 'project', scopeId: 'P-1', key: 'settings' },
      },
      {
        method: 'openforge.storage.set',
        params: { pluginId: 'scheduler', scope: 'task', scopeId: 'T-1', key: 'cursor', value: { page: 2 } },
      },
      {
        method: 'openforge.storage.delete',
        params: { pluginId: 'scheduler', scope: 'global', scopeId: null, key: 'legacy' },
      },
    ])
  })
})
