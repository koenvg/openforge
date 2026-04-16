import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'
import { installPlugin, uninstallPlugin as uninstallPluginIpc, getEnabledPlugins, fsReadFile } from '../ipc'
import { installedPlugins, enabledPluginIds } from './pluginStore'
import { get } from 'svelte/store'
import {
  loadPluginFrontend,
  activatePlugin as activatePluginLoader,
  deactivatePlugin as deactivatePluginLoader,
  isPluginLoaded,
} from './pluginLoader'
import type { PluginContext } from './types'

export async function installPluginFromNpm(_packageName: string): Promise<void> {
  throw new Error('Not implemented: NPM install')
}

export async function installPluginFromManifest(manifest: PluginManifest, installPath: string): Promise<void> {
  if (manifest.apiVersion > MAX_SUPPORTED_API_VERSION) {
    throw new Error(`Unsupported API version: ${manifest.apiVersion}`)
  }

  await installPlugin({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    permissions: JSON.stringify(manifest.permissions),
    contributes: JSON.stringify(manifest.contributes),
    frontendEntry: manifest.frontend,
    backendEntry: manifest.backend,
    installPath,
    installedAt: Date.now(),
    isBuiltin: false,
  })

  installedPlugins.update(map => {
    const next = new Map(map)
    next.set(manifest.id, { manifest, state: 'installed', error: null })
    return next
  })
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  if (isPluginLoaded(pluginId)) {
    await deactivatePluginLoader(pluginId)
  }
  await uninstallPluginIpc(pluginId)
  installedPlugins.update(map => {
    const next = new Map(map)
    next.delete(pluginId)
    return next
  })
}

export async function loadEnabledForProject(projectId: string): Promise<void> {
  const rows = await getEnabledPlugins(projectId)
  enabledPluginIds.set(new Set(rows.map(r => r.id)))
}

function makePluginContext(): PluginContext {
  return {
    invokeHost: async (_command, _payload) => null,
    invokeBackend: async (_method, _payload) => null,
    onEvent: (_event, _handler) => () => {},
    storage: {
      get: async (_key) => null,
      set: async (_key, _value) => {},
    },
  }
}

export async function activatePlugin(pluginId: string): Promise<boolean> {
  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  const loaded = await loadPluginFrontend(pluginId, entry.manifest.frontend)
  if (!loaded) return false

  const context = makePluginContext()
  const result = await activatePluginLoader(pluginId, context)
  return result !== null
}

export async function deactivatePluginById(pluginId: string): Promise<void> {
  await deactivatePluginLoader(pluginId)
}

export async function installFromLocal(pluginPath: string, projectId: string): Promise<void> {
  const file = await fsReadFile(projectId, `${pluginPath}/manifest.json`)
  const data: unknown = JSON.parse(file.content)
  if (
    data === null ||
    typeof data !== 'object' ||
    !('id' in data) ||
    !('name' in data) ||
    !('version' in data) ||
    !('apiVersion' in data) ||
    !('description' in data) ||
    !('frontend' in data)
  ) {
    throw new Error('Invalid plugin manifest: missing required fields')
  }
  const manifest = data as PluginManifest
  await installPluginFromManifest(manifest, pluginPath)
}
