import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'
import {
  fsReadFile,
  getEnabledPlugins,
  getPluginStorage,
  installPlugin,
  pluginInvoke,
  setPluginStorage,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import { installedPlugins, enabledPluginIds } from './pluginStore'
import { get } from 'svelte/store'
import {
  loadPluginFrontend,
  activatePlugin as activatePluginLoader,
  deactivatePlugin as deactivatePluginLoader,
  isPluginLoaded,
} from './pluginLoader'
import type { PluginContext } from './types'
import { activeProjectId, currentView, selectedTaskId } from '../stores'

type PluginHostEventName = 'context-changed' | 'navigation-changed' | 'selection-changed'

type PluginHostContextSnapshot = {
  activeProjectId: string | null
  currentView: string
  selectedTaskId: string | null
}

type PluginHostListener = (payload: unknown) => void

const pluginHostListeners = new Map<PluginHostEventName, Set<PluginHostListener>>()

function subscribeToPluginHostEvent(event: string, handler: PluginHostListener): () => void {
  const typedEvent = event as PluginHostEventName
  const listeners = pluginHostListeners.get(typedEvent) ?? new Set<PluginHostListener>()
  listeners.add(handler)
  pluginHostListeners.set(typedEvent, listeners)

  return () => {
    const currentListeners = pluginHostListeners.get(typedEvent)
    currentListeners?.delete(handler)
    if (currentListeners && currentListeners.size === 0) {
      pluginHostListeners.delete(typedEvent)
    }
  }
}

function getContextSnapshot(): PluginHostContextSnapshot {
  return {
    activeProjectId: get(activeProjectId),
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
  }
}

export function emitPluginHostEvent(event: PluginHostEventName, payload: unknown): void {
  const listeners = pluginHostListeners.get(event)
  if (!listeners) return

  for (const listener of listeners) {
    listener(payload)
  }
}

let storeSubscriptionsInitialized = false

function ensurePluginHostStoreSubscriptions(): void {
  if (storeSubscriptionsInitialized) return
  storeSubscriptionsInitialized = true

  let previousContext = getContextSnapshot()

  const emitContextUpdates = () => {
    const nextContext = getContextSnapshot()

    if (nextContext.selectedTaskId !== previousContext.selectedTaskId) {
      emitPluginHostEvent('selection-changed', { selectedTaskId: nextContext.selectedTaskId })
    }

    if (nextContext.activeProjectId !== previousContext.activeProjectId || nextContext.currentView !== previousContext.currentView) {
      emitPluginHostEvent('navigation-changed', {
        activeProjectId: nextContext.activeProjectId,
        currentView: nextContext.currentView,
      })
    }

    if (
      nextContext.activeProjectId !== previousContext.activeProjectId
      || nextContext.currentView !== previousContext.currentView
      || nextContext.selectedTaskId !== previousContext.selectedTaskId
    ) {
      emitPluginHostEvent('context-changed', nextContext)
    }

    previousContext = nextContext
  }

  activeProjectId.subscribe(emitContextUpdates)
  currentView.subscribe(emitContextUpdates)
  selectedTaskId.subscribe(emitContextUpdates)
}

async function invokePluginHostCommand(command: string, payload: unknown): Promise<unknown> {
  const commandPayload = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : undefined

  switch (command) {
    case 'getContext':
      return getContextSnapshot()
    case 'getSelection':
      return { selectedTaskId: get(selectedTaskId) }
    case 'getNavigation':
      return {
        activeProjectId: get(activeProjectId),
        currentView: get(currentView),
      }
    case 'getTaskContext': {
      const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : get(selectedTaskId)
      return { taskId }
    }
    case 'getProjectContext': {
      const projectId = typeof commandPayload?.projectId === 'string' ? commandPayload.projectId : get(activeProjectId)
      return { projectId }
    }
    case 'navigate': {
      if (typeof commandPayload?.currentView === 'string') {
        currentView.set(commandPayload.currentView)
      }

      if (typeof commandPayload?.selectedTaskId === 'string' || commandPayload?.selectedTaskId === null) {
        selectedTaskId.set(commandPayload?.selectedTaskId ?? null)
      }

      if (typeof commandPayload?.activeProjectId === 'string' || commandPayload?.activeProjectId === null) {
        activeProjectId.set(commandPayload?.activeProjectId ?? null)
      }

      return getContextSnapshot()
    }
    default:
      throw new Error(`Unknown plugin host command: ${command}`)
  }
}

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

export async function activatePlugin(pluginId: string): Promise<boolean> {
  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  const loaded = await loadPluginFrontend(pluginId, entry.manifest.frontend)
  if (!loaded) return false

  const context = makePluginContextForPlugin(pluginId)
  const result = await activatePluginLoader(pluginId, context)
  return result !== null
}

function makePluginContextForPlugin(pluginId: string): PluginContext {
  ensurePluginHostStoreSubscriptions()

  return {
    pluginId,
    invokeHost: async (command, payload) => invokePluginHostCommand(command, payload),
    invokeBackend: async (method, payload) => pluginInvoke(pluginId, method, payload ?? null),
    onEvent: (event, handler) => subscribeToPluginHostEvent(event, handler),
    storage: {
      get: async key => getPluginStorage(pluginId, key),
      set: async (key, value) => setPluginStorage(pluginId, key, value),
    },
  }
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
