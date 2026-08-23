import { describe, expect, it } from 'vitest'
import { createPluginHostRuntime } from './index'
import { writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend storage', () => {
  it('exposes scoped JSON storage to backend plugins with plugin/project/task isolation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          await openforge.storage.global.set('settings', { enabled: true, pluginId: context.pluginId })
          await openforge.storage.project('P-1').set('repo', { owner: 'acme', name: context.pluginId })
          await openforge.storage.project('P-2').set('repo', { owner: 'acme', name: 'other' })
          await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
          context.subscriptions.add(openforge.backend.registerMethod('readStorage', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                projectOne: await openforge.storage.project('P-1').get('repo'),
                projectTwo: await openforge.storage.project('P-2').get('repo'),
                taskOne: await openforge.storage.task('T-1').get('reviewState'),
                taskTwo: await openforge.storage.task('T-2').get('reviewState')
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'alpha', backendPath })
    await runtime.activateBackend({ pluginId: 'beta', backendPath })

    await expect(runtime.invokeBackend({ pluginId: 'alpha', command: 'readStorage' })).resolves.toEqual({
      global: { enabled: true, pluginId: 'alpha' },
      projectOne: { owner: 'acme', name: 'alpha' },
      projectTwo: { owner: 'acme', name: 'other' },
      taskOne: { viewedFiles: ['README.md'] },
      taskTwo: null,
    })
    await expect(runtime.invokeBackend({ pluginId: 'beta', command: 'readStorage' })).resolves.toMatchObject({
      global: { enabled: true, pluginId: 'beta' },
      projectOne: { owner: 'acme', name: 'beta' },
    })
  })

  it('persists backend plugin storage through host callbacks instead of runtime memory', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('write', {
            async handler() {
              await openforge.storage.global.set('settings', { enabled: true })
              await openforge.storage.project('P-1').set('repo', { owner: 'acme' })
              await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
              return 'written'
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('read', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                project: await openforge.storage.project('P-1').get('repo'),
                task: await openforge.storage.task('T-1').get('reviewState'),
                otherPlugin: await openforge.storage.project('P-2').get('repo')
              }
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('deleteProject', {
            async handler() {
              await openforge.storage.project('P-1').delete('repo')
              return await openforge.storage.project('P-1').get('repo')
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const durableStorage = new Map<string, unknown>()
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      const { pluginId, scope, scopeId, key, value } = request.params
      const storageKey = JSON.stringify([pluginId, scope, scopeId ?? null, key])
      if (request.method === 'openforge.storage.get') return durableStorage.has(storageKey) ? durableStorage.get(storageKey) : null
      if (request.method === 'openforge.storage.set') {
        durableStorage.set(storageKey, value)
        return null
      }
      if (request.method === 'openforge.storage.delete') {
        durableStorage.delete(storageKey)
        return null
      }
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'write' })).resolves.toBe('written')
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'read' })).resolves.toEqual({
      global: { enabled: true },
      project: { owner: 'acme' },
      task: { viewedFiles: ['README.md'] },
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'other', backendPath, command: 'read' })).resolves.toEqual({
      global: null,
      project: null,
      task: null,
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'deleteProject' })).resolves.toBeNull()

    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'global', scopeId: null, key: 'settings', value: { enabled: true } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo', value: { owner: 'acme' } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'task', scopeId: 'T-1', key: 'reviewState', value: { viewedFiles: ['README.md'] } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.delete', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo' } })
  })
})
