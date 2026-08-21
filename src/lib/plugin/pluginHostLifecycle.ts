import { get } from 'svelte/store'
import type { BackendReadyState } from '@openforge-app/plugin-sdk'
import {
  pluginBackendDeactivate,
  pluginBackendWhenReady,
  pluginInvoke,
} from '../ipc'
import {
  ensurePluginHostStoreSubscriptions,
  subscribeToPluginHostEvent,
} from './pluginHostEvents'
import { installedPlugins } from './pluginStore'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

const pluginBackendReadyStates = new Map<string, BackendReadyState>()

type LifecycleHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'getBackendState'
  | 'whenBackendReady'
  | 'onBackendReady'
  | 'invokeBackendMethod'
  | 'invokeHostCommand'
  | 'onHostEvent'
>>

type InvokeHostCommand = NonNullable<RuntimeHostBridge['invokeHostCommand']>

export function clearPluginRuntimeHostState(pluginId: string): void {
  pluginBackendReadyStates.delete(pluginId)
}

export async function deactivatePluginBackend(pluginId: string): Promise<void> {
  const entry = get(installedPlugins).get(pluginId)
  if (!entry?.manifest.backend) return

  await pluginBackendDeactivate(pluginId)
  clearPluginRuntimeHostState(pluginId)
}

export async function ensurePluginBackendReady(pluginId: string): Promise<void> {
  const entry = get(installedPlugins).get(pluginId)
  if (!entry?.manifest.backend) {
    throw new Error(`Plugin backend is unavailable for ${pluginId}`)
  }

  if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
    pluginBackendReadyStates.set(pluginId, 'starting')
  }

  try {
    await pluginBackendWhenReady(pluginId)
    pluginBackendReadyStates.set(pluginId, 'ready')
  } catch (error) {
    pluginBackendReadyStates.set(pluginId, 'error')
    throw error
  }
}

export function createPluginLifecycleHostCapabilities(
  pluginId: string,
  invokeHostCommand: InvokeHostCommand,
): LifecycleHostCapabilities {
  const entry = get(installedPlugins).get(pluginId)
  if (entry?.manifest.backend && entry.state !== 'active') {
    pluginBackendReadyStates.set(pluginId, 'starting')
  } else if (!entry?.manifest.backend) {
    pluginBackendReadyStates.delete(pluginId)
  }

  return {
    getBackendState: () => {
      const entry = get(installedPlugins).get(pluginId)
      if (!entry?.manifest.backend) return 'missing' as const
      if (entry.state === 'error') return 'error' as const
      return pluginBackendReadyStates.get(pluginId) ?? 'starting'
    },
    whenBackendReady: async () => {
      await ensurePluginBackendReady(pluginId)
    },
    onBackendReady: (handler) => {
      const entry = get(installedPlugins).get(pluginId)
      let disposed = false
      if (entry?.manifest.backend) {
        if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
          pluginBackendReadyStates.set(pluginId, 'starting')
        }
        pluginBackendWhenReady(pluginId).then(() => {
          pluginBackendReadyStates.set(pluginId, 'ready')
          if (!disposed) handler()
        }).catch(() => {
          pluginBackendReadyStates.set(pluginId, 'error')
        })
      }
      return () => { disposed = true }
    },
    invokeBackendMethod: async (method, payload) => {
      try {
        const result = await pluginInvoke(pluginId, method, payload ?? null)
        pluginBackendReadyStates.set(pluginId, 'ready')
        return result
      } catch (error) {
        pluginBackendReadyStates.set(pluginId, 'error')
        throw error
      }
    },
    invokeHostCommand: (command, payload) => {
      ensurePluginHostStoreSubscriptions()
      return invokeHostCommand(command, payload)
    },
    onHostEvent: (event, handler) => {
      ensurePluginHostStoreSubscriptions()
      return subscribeToPluginHostEvent(pluginId, event, handler)
    },
  }
}
