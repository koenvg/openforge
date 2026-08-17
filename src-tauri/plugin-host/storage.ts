import type { PluginStorage } from '@openforge-app/plugin-sdk'
import type { HostCallbackHandler } from './runtime-types'

function createMemoryStorageScope() {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> {
      return values.has(key) ? values.get(key) as T : null
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value)
    },
    async delete(key: string): Promise<void> {
      values.delete(key)
    },
  }
}

export function createMemoryStorage(): PluginStorage {
  const global = createMemoryStorageScope()
  const projects = new Map<string, ReturnType<typeof createMemoryStorageScope>>()
  const tasks = new Map<string, ReturnType<typeof createMemoryStorageScope>>()

  return {
    global,
    project(projectId: string) {
      let scope = projects.get(projectId)
      if (!scope) {
        scope = createMemoryStorageScope()
        projects.set(projectId, scope)
      }
      return scope
    },
    task(taskId: string) {
      let scope = tasks.get(taskId)
      if (!scope) {
        scope = createMemoryStorageScope()
        tasks.set(taskId, scope)
      }
      return scope
    },
  }
}

function createHostStorageScope(
  pluginId: string,
  scope: 'global' | 'project' | 'task',
  scopeId: string | null,
  hostCallbacks: HostCallbackHandler,
) {
  const params = (key: string, value?: unknown, includeValue = false): Record<string, unknown> => {
    const payload: Record<string, unknown> = { pluginId, scope, scopeId, key }
    if (includeValue) payload.value = value
    return payload
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      return await hostCallbacks({ method: 'openforge.storage.get', params: params(key) }) as T | null
    },
    async set<T>(key: string, value: T): Promise<void> {
      await hostCallbacks({ method: 'openforge.storage.set', params: params(key, value, true) })
    },
    async delete(key: string): Promise<void> {
      await hostCallbacks({ method: 'openforge.storage.delete', params: params(key) })
    },
  }
}

export function createHostStorage(pluginId: string, hostCallbacks: HostCallbackHandler): PluginStorage {
  return {
    global: createHostStorageScope(pluginId, 'global', null, hostCallbacks),
    project: (projectId: string) => createHostStorageScope(pluginId, 'project', projectId, hostCallbacks),
    task: (taskId: string) => createHostStorageScope(pluginId, 'task', taskId, hostCallbacks),
  }
}
