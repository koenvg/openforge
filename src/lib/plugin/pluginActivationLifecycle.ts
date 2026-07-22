import { get } from 'svelte/store'
import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type { OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { openUrl } from '../ipc'
import { activeProjectId } from '../stores'
import { installedPlugins } from './pluginStore'
import { clearLoadedPlugin, loadPluginFrontend, deactivatePlugin as deactivatePluginLoader, isFrontendPluginModule } from './pluginLoader'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'
import type { RuntimeContributionRegistryInstance } from './runtimeContributionRegistry'
import { createIpcPluginStorage } from './pluginStorage'
import type { PluginManifest } from './types'
import { getPackageMetadataForPlugin, setPluginRuntimeError, setPluginRuntimeState } from './pluginInstallState'
import { clearPluginRuntimeHostState, createPluginRuntimeHost, deactivatePluginBackend } from './pluginHostCommands'
import { clearPluginHostSubscriptions } from './pluginHostEvents'
import {
  applyRuntimeSnapshotContributions,
  clearPluginRuntimeContributions,
  getPluginCommandHandler,
  hasPluginCommandHandler,
  stopPluginBackgroundServices,
} from './pluginRuntimeContributions'

type ActivationRecord = {
  generation: number
  promise: Promise<boolean>
}

const activationPromises = new Map<string, ActivationRecord>()
const activeRuntimeRegistries = new Map<string, RuntimeContributionRegistryInstance>()
const pluginFrontendReloadGenerations = new Map<string, number>()

function appendReloadGenerationQuery(assetUrl: string, generation: number): string {
  const hashIndex = assetUrl.indexOf('#')
  const beforeHash = hashIndex >= 0 ? assetUrl.slice(0, hashIndex) : assetUrl
  const hash = hashIndex >= 0 ? assetUrl.slice(hashIndex) : ''
  const separator = beforeHash.includes('?') ? '&' : '?'
  return `${beforeHash}${separator}openforgeReload=${generation}${hash}`
}

function bumpPluginFrontendReloadGeneration(pluginId: string): void {
  pluginFrontendReloadGenerations.set(pluginId, (pluginFrontendReloadGenerations.get(pluginId) ?? 0) + 1)
}

function normalizePluginAssetUrl(pluginId: string, frontendEntry: string, activationGeneration: number): string {
  const entry = frontendEntry.replace(/^\.\//, '').replace(/^\//, '')
  const assetUrl = `plugin://${pluginId}/${entry}`
  return activationGeneration === 0
    ? assetUrl
    : appendReloadGenerationQuery(assetUrl, activationGeneration)
}

function createFrontendRuntimeRegistryForPlugin(pluginId: string, manifest: PluginManifest): RuntimeContributionRegistryInstance {
  return createRuntimeContributionRegistry({
    pluginId,
    projectId: get(activeProjectId),
    packageMetadata: getPackageMetadataForPlugin(pluginId, manifest),
    storage: createIpcPluginStorage(pluginId),
    host: createPluginRuntimeHost(pluginId),
  })
}

async function discardFrontendRuntimeActivation(pluginId: string, runtimeRegistry: RuntimeContributionRegistryInstance): Promise<void> {
  let cleanupError: unknown = null
  try {
    await runtimeRegistry.deactivate()
  } catch (error) {
    cleanupError = error
  }

  activeRuntimeRegistries.delete(pluginId)
  clearPluginRuntimeHostState(pluginId)
  try {
    await stopPluginBackgroundServices(pluginId)
  } catch (error) {
    cleanupError ??= error
  } finally {
    clearPluginRuntimeContributions(pluginId)
  }

  if (cleanupError !== null) {
    console.error(`[pluginActivationLifecycle] Failed to discard frontend runtime activation for ${pluginId}:`, cleanupError)
  }
}

async function activateFrontendRuntimePlugin(
  pluginId: string,
  manifest: PluginManifest,
  frontendPlugin: Parameters<RuntimeContributionRegistryInstance['activateFrontend']>[0],
  activationGeneration: number,
): Promise<boolean> {
  const runtimeRegistry = createFrontendRuntimeRegistryForPlugin(pluginId, manifest)

  try {
    await runtimeRegistry.activateFrontend(frontendPlugin)
    if ((pluginFrontendReloadGenerations.get(pluginId) ?? 0) !== activationGeneration) {
      await discardFrontendRuntimeActivation(pluginId, runtimeRegistry)
      setPluginRuntimeState(pluginId, 'installed', null)
      return false
    }
    await applyRuntimeSnapshotContributions(pluginId, runtimeRegistry.getSnapshot())
    if ((pluginFrontendReloadGenerations.get(pluginId) ?? 0) !== activationGeneration) {
      await discardFrontendRuntimeActivation(pluginId, runtimeRegistry)
      setPluginRuntimeState(pluginId, 'installed', null)
      return false
    }
    activeRuntimeRegistries.set(pluginId, runtimeRegistry)
    setPluginRuntimeState(pluginId, 'active', null)
    return true
  } catch (error) {
    await discardFrontendRuntimeActivation(pluginId, runtimeRegistry)
    if ((pluginFrontendReloadGenerations.get(pluginId) ?? 0) !== activationGeneration) {
      setPluginRuntimeState(pluginId, 'installed', null)
      return false
    }
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function activateBuiltinPluginModule(pluginId: string, activationGeneration: number): Promise<boolean> {
  try {
    const { getBuiltinPluginModule } = await import('./builtinPluginModules')
    const builtinModule = getBuiltinPluginModule(pluginId)
    if (!builtinModule) {
      throw new Error(`Unknown builtin plugin: ${pluginId}`)
    }

    if (isFrontendPluginModule(builtinModule)) {
      const manifest = get(installedPlugins).get(pluginId)?.manifest
      if (!manifest) {
        throw new Error(`Builtin plugin ${pluginId} is not installed`)
      }
      return activateFrontendRuntimePlugin(pluginId, manifest, builtinModule, activationGeneration)
    }

    throw new Error(`Builtin plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; built-ins must use defineFrontendPlugin(...) runtime registration`)
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function activateExternalPluginModule(pluginId: string, manifest: PluginManifest, activationGeneration: number): Promise<boolean> {
  if (!manifest.frontend) {
    if (!manifest.backend) {
      setPluginRuntimeError(pluginId, new Error(`Plugin ${pluginId} metadata is missing a frontend or backend entry`))
      return false
    }

    setPluginRuntimeState(pluginId, 'active', null)
    return true
  }

  const frontendUrl = normalizePluginAssetUrl(pluginId, manifest.frontend, activationGeneration)
  const frontendStyles = get(installedPlugins).get(pluginId)?.packageMetadata?.frontendStyles ?? []
  const stylesheetUrls = frontendStyles.map(stylesheet => normalizePluginAssetUrl(pluginId, stylesheet, activationGeneration))
  const loaded = stylesheetUrls.length > 0
    ? await loadPluginFrontend(pluginId, frontendUrl, stylesheetUrls)
    : await loadPluginFrontend(pluginId, frontendUrl)
  if (!loaded) return false

  if (isFrontendPluginModule(loaded.module)) {
    const activated = await activateFrontendRuntimePlugin(pluginId, manifest, loaded.module, activationGeneration)
    if (!activated) clearLoadedPlugin(pluginId)
    return activated
  }

  clearLoadedPlugin(pluginId)
  setPluginRuntimeError(pluginId, new Error(`Plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime`))
  return false
}

function isBackendOnlyExternalPlugin(pluginId: string): boolean {
  const entry = get(installedPlugins).get(pluginId)
  return Boolean(entry && !entry.isBuiltin && !entry.manifest.frontend && entry.manifest.backend)
}

async function deactivateLoadedPluginModule(pluginId: string): Promise<void> {
  const runtimeRegistry = activeRuntimeRegistries.get(pluginId)
  if (runtimeRegistry) {
    try {
      await runtimeRegistry.deactivate()
    } finally {
      activeRuntimeRegistries.delete(pluginId)
      clearPluginRuntimeHostState(pluginId)
      clearLoadedPlugin(pluginId)
    }
    setPluginRuntimeState(pluginId, 'installed', null)
    return
  }

  if (isBackendOnlyExternalPlugin(pluginId)) {
    clearPluginRuntimeHostState(pluginId)
    setPluginRuntimeState(pluginId, 'installed', null)
    return
  }

  await deactivatePluginLoader(pluginId)
}

export function _resetPluginActivationLifecycleForTests(): void {
  activationPromises.clear()
  activeRuntimeRegistries.clear()
  pluginFrontendReloadGenerations.clear()
}

export async function activatePlugin(pluginId: string): Promise<boolean> {
  const activationGeneration = pluginFrontendReloadGenerations.get(pluginId) ?? 0
  const pendingActivation = activationPromises.get(pluginId)
  if (pendingActivation) {
    if (pendingActivation.generation === activationGeneration) {
      return pendingActivation.promise
    }

    await pendingActivation.promise.catch(() => false)
    return activatePlugin(pluginId)
  }

  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  if (entry.state === 'active' && (activeRuntimeRegistries.has(pluginId) || isBackendOnlyExternalPlugin(pluginId))) {
    return true
  }

  const activation = (async () => {
    clearPluginRuntimeContributions(pluginId)
    await stopPluginBackgroundServices(pluginId)

    const activated = entry.isBuiltin
      ? await activateBuiltinPluginModule(pluginId, activationGeneration)
      : await activateExternalPluginModule(pluginId, entry.manifest, activationGeneration)

    return activated
  })()

  const activationRecord: ActivationRecord = { generation: activationGeneration, promise: activation }
  activationRecord.promise = activation.finally(() => {
    if (activationPromises.get(pluginId) === activationRecord) {
      activationPromises.delete(pluginId)
    }
  })
  activationPromises.set(pluginId, activationRecord)
  return activationRecord.promise
}

export async function executePluginCommand(pluginId: string, commandId: string, payload?: unknown): Promise<boolean> {
  if (!hasPluginCommandHandler(pluginId, commandId)) {
    const activated = await activatePlugin(pluginId)
    if (!activated) {
      return false
    }
  }

  const handler = getPluginCommandHandler(pluginId, commandId)
  if (!handler) {
    return false
  }

  await handler(payload)
  return true
}

function createUnavailableFrontendApi(pluginId: string): FrontendOpenForgeAPI {
  const unavailable = (capability: string) => async () => {
    throw new Error(`OpenForge frontend runtime API is unavailable for plugin ${pluginId}: ${capability}`)
  }
  const unavailableStorageScope = (scope: string) => ({
    get: unavailable(`${scope}.get`),
    set: unavailable(`${scope}.set`),
    delete: unavailable(`${scope}.delete`),
  })

  return {
    browserSurfaces: {
      getOrCreate: async () => {
        throw new BrowserSurfaceError('CAPABILITY_UNAVAILABLE', `OpenForge frontend runtime API is unavailable for plugin ${pluginId}: browserSurfaces.getOrCreate`)
      },
      resetSession: async () => {
        throw new BrowserSurfaceError('CAPABILITY_UNAVAILABLE', `OpenForge frontend runtime API is unavailable for plugin ${pluginId}: browserSurfaces.resetSession`)
      },
    },
    commands: {
      register: () => ({ dispose: () => undefined }),
      invoke: unavailable('commands.invoke'),
      invokeGlobal: unavailable('commands.invokeGlobal'),
      list: unavailable('commands.list'),
      listCatalog: unavailable('commands.listCatalog'),
    },
    events: {
      on: () => ({ dispose: () => undefined }),
      onGlobal: () => ({ dispose: () => undefined }),
      emit: unavailable('events.emit'),
      emitGlobal: unavailable('events.emitGlobal'),
    },
    storage: {
      global: unavailableStorageScope('storage.global'),
      project: () => unavailableStorageScope('storage.project'),
      task: () => unavailableStorageScope('storage.task'),
    },
    context: {
      getSnapshot: () => ({ pluginId, projectId: get(activeProjectId) }),
    },
    tasks: {
      list: unavailable('tasks.list'),
      get: unavailable('tasks.get'),
      create: unavailable('tasks.create'),
      updateSummary: unavailable('tasks.updateSummary'),
      updateStatus: unavailable('tasks.updateStatus'),
      listStartPromptContributions: unavailable('tasks.listStartPromptContributions'),
      configureStartPromptContribution: unavailable('tasks.configureStartPromptContribution'),
      startImplementation: unavailable('tasks.startImplementation'),
      getWorkspace: unavailable('tasks.getWorkspace'),
      getLatestSession: unavailable('tasks.getLatestSession'),
    },
    projects: {
      list: unavailable('projects.list'),
      get: unavailable('projects.get'),
    },
    fs: { readDir: unavailable('fs.readDir'), readFile: unavailable('fs.readFile'), writeFile: unavailable('fs.writeFile'), searchFiles: unavailable('fs.searchFiles') },
    shell: { spawn: unavailable('shell.spawn'), write: unavailable('shell.write'), resize: unavailable('shell.resize'), kill: unavailable('shell.kill'), getBuffer: unavailable('shell.getBuffer') },
    notifications: { notify: unavailable('notifications.notify') },
    attention: { listProjects: unavailable('attention.listProjects') },
    system: { openUrl: async (url: string) => openUrl(url) },
    navigation: {
      get: () => ({ activeProjectId: get(activeProjectId), currentView: 'board', selectedTaskId: null }),
      navigate: unavailable('navigation.navigate'),
    },
    config: { get: unavailable('config.get'), set: unavailable('config.set') },
    projectConfig: { get: unavailable('projectConfig.get'), set: unavailable('projectConfig.set') },
    views: { register: () => ({ dispose: () => undefined }) },
    taskUI: {
      registerTab: () => ({ dispose: () => undefined }),
      registerSection: () => ({ dispose: () => undefined }),
    },
    taskPane: { registerTab: () => ({ dispose: () => undefined }) },
    settings: { registerSection: () => ({ dispose: () => undefined }) },
    injectionPoints: { register: () => ({ dispose: () => undefined }) },
    backend: {
      state: 'missing',
      whenReady: unavailable('backend.whenReady'),
      onReady: () => ({ dispose: () => undefined }),
      invoke: unavailable('backend.invoke'),
    },
  }
}

export function getPluginRenderProps(pluginId: string, options: { projectId: string | null; taskId?: string | null }): { api: FrontendOpenForgeAPI; context: OpenForgeContextSnapshot } {
  const runtimeRegistry = activeRuntimeRegistries.get(pluginId)
  if (!runtimeRegistry) {
    return {
      api: createUnavailableFrontendApi(pluginId),
      context: {
        pluginId,
        projectId: options.projectId,
        taskId: options.taskId ?? null,
      },
    }
  }

  return {
    api: runtimeRegistry.getFrontendApi(),
    context: runtimeRegistry.createRenderContextSnapshot(options.projectId, options.taskId ?? null),
  }
}

export function listInjectionPointsAcrossPlugins(
  location: import('@openforge-app/plugin-sdk').InjectionPointLocation,
  enabledIds: Iterable<string>,
): import('./runtimeContributionRegistry').RuntimeInjectionPointContribution[] {
  const result: import('./runtimeContributionRegistry').RuntimeInjectionPointContribution[] = []
  for (const pluginId of enabledIds) {
    const registry = activeRuntimeRegistries.get(pluginId)
    if (registry) {
      result.push(...registry.listInjectionPoints(location))
    }
  }
  return result
}

export async function deactivatePluginById(pluginId: string): Promise<void> {
  await deactivatePluginBackend(pluginId)
  bumpPluginFrontendReloadGeneration(pluginId)
  await deactivateLoadedPluginModule(pluginId)
  clearPluginRuntimeContributions(pluginId)
  await stopPluginBackgroundServices(pluginId)
  clearPluginHostSubscriptions(pluginId)
  setPluginRuntimeState(pluginId, 'installed', null)
}
