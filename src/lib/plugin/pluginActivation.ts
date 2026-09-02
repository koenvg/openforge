import { get } from 'svelte/store'
import { activeProjectId } from '../stores'
import { failPendingFrontendPluginCommands } from '../frontendHostRequestBridge'
import { installedPlugins } from './pluginStore'
import {
  clearLoadedPlugin,
  deactivatePlugin as deactivatePluginLoader,
  isFrontendPluginModule,
  loadPluginFrontend,
} from './pluginLoader'
import {
  createRuntimeContributionRegistry,
  type RuntimeContributionRegistryInstance,
} from './runtimeContributionRegistry'
import { createIpcPluginStorage } from './pluginStorage'
import type { PluginManifest } from './types'
import {
  getPackageMetadataForPlugin,
  setPluginRuntimeError,
  setPluginRuntimeState,
} from './pluginInstallState'
import {
  clearPluginRuntimeHostState,
  createPluginRuntimeHost,
  deactivatePluginBackend,
  destroyPluginBrowserSurfaces,
} from './pluginHostCommands'
import { clearPluginHostSubscriptions } from './pluginHostEvents'
import { clearPluginTaskInvalidationSubscriptions } from './pluginTaskInvalidations'
import {
  applyRuntimeSnapshotContributions,
  clearPluginRuntimeContributions,
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
  pluginFrontendReloadGenerations.set(
    pluginId,
    (pluginFrontendReloadGenerations.get(pluginId) ?? 0) + 1,
  )
}

function normalizePluginAssetUrl(
  pluginId: string,
  frontendEntry: string,
  activationGeneration: number,
): string {
  const entry = frontendEntry.replace(/^\.\//, '').replace(/^\//, '')
  const assetUrl = `plugin://${pluginId}/${entry}`
  return activationGeneration === 0
    ? assetUrl
    : appendReloadGenerationQuery(assetUrl, activationGeneration)
}

function createFrontendRuntimeRegistryForPlugin(
  pluginId: string,
  manifest: PluginManifest,
  projectId: string | null,
): RuntimeContributionRegistryInstance {
  const packageMetadata = getPackageMetadataForPlugin(pluginId, manifest)
  return createRuntimeContributionRegistry({
    pluginId,
    projectId: packageMetadata.enablement === 'app' ? null : projectId,
    packageMetadata,
    storage: createIpcPluginStorage(pluginId),
    host: createPluginRuntimeHost(pluginId),
  })
}

async function discardFrontendRuntimeActivation(
  pluginId: string,
  runtimeRegistry: RuntimeContributionRegistryInstance,
): Promise<void> {
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
    console.error(
      `[pluginActivationLifecycle] Failed to discard frontend runtime activation for ${pluginId}:`,
      cleanupError,
    )
  }
}

async function activateFrontendRuntimePlugin(
  pluginId: string,
  manifest: PluginManifest,
  frontendPlugin: Parameters<RuntimeContributionRegistryInstance['activateFrontend']>[0],
  activationGeneration: number,
  projectId: string | null,
): Promise<boolean> {
  const runtimeRegistry = createFrontendRuntimeRegistryForPlugin(pluginId, manifest, projectId)

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
    runtimeRegistry.commitFrontendThemes(activationGeneration)
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

async function activateBuiltinPluginModule(
  pluginId: string,
  activationGeneration: number,
  projectId: string | null,
): Promise<boolean> {
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
      return activateFrontendRuntimePlugin(
        pluginId,
        manifest,
        builtinModule,
        activationGeneration,
        projectId,
      )
    }

    throw new Error(
      `Builtin plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; built-ins must use defineFrontendPlugin(...) runtime registration`,
    )
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function activateExternalPluginModule(
  pluginId: string,
  manifest: PluginManifest,
  activationGeneration: number,
  projectId: string | null,
): Promise<boolean> {
  if (!manifest.frontend) {
    if (!manifest.backend) {
      setPluginRuntimeError(
        pluginId,
        new Error(`Plugin ${pluginId} metadata is missing a frontend or backend entry`),
      )
      return false
    }

    setPluginRuntimeState(pluginId, 'active', null)
    return true
  }

  const frontendUrl = normalizePluginAssetUrl(
    pluginId,
    manifest.frontend,
    activationGeneration,
  )
  const frontendStyles =
    get(installedPlugins).get(pluginId)?.packageMetadata?.frontendStyles ?? []
  const stylesheetUrls = frontendStyles.map((stylesheet) =>
    normalizePluginAssetUrl(pluginId, stylesheet, activationGeneration),
  )
  const loaded =
    stylesheetUrls.length > 0
      ? await loadPluginFrontend(pluginId, frontendUrl, stylesheetUrls)
      : await loadPluginFrontend(pluginId, frontendUrl)
  if (!loaded) return false

  if (isFrontendPluginModule(loaded.module)) {
    const activated = await activateFrontendRuntimePlugin(
      pluginId,
      manifest,
      loaded.module,
      activationGeneration,
      projectId,
    )
    if (!activated) clearLoadedPlugin(pluginId)
    return activated
  }

  clearLoadedPlugin(pluginId)
  setPluginRuntimeError(
    pluginId,
    new Error(
      `Plugin ${pluginId} uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime`,
    ),
  )
  return false
}

function isBackendOnlyExternalPlugin(pluginId: string): boolean {
  const entry = get(installedPlugins).get(pluginId)
  return Boolean(
    entry && !entry.isBuiltin && !entry.manifest.frontend && entry.manifest.backend,
  )
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

export function getActivePluginRuntimeRegistry(
  pluginId: string,
): RuntimeContributionRegistryInstance | undefined {
  return activeRuntimeRegistries.get(pluginId)
}

export async function publishPluginContextChange(
  pluginId: string,
  projectId: string | null,
): Promise<void> {
  await activeRuntimeRegistries.get(pluginId)?.publishContextChange(projectId)
}

export function _resetPluginActivationLifecycleForTests(): void {
  activationPromises.clear()
  activeRuntimeRegistries.clear()
  pluginFrontendReloadGenerations.clear()
}

export async function activatePlugin(
  pluginId: string,
  projectId: string | null = get(activeProjectId),
): Promise<boolean> {
  const activationGeneration = pluginFrontendReloadGenerations.get(pluginId) ?? 0
  const pendingActivation = activationPromises.get(pluginId)
  if (pendingActivation) {
    if (pendingActivation.generation === activationGeneration) {
      return pendingActivation.promise
    }

    await pendingActivation.promise.catch(() => false)
    return activatePlugin(pluginId, projectId)
  }

  const map = get(installedPlugins)
  const entry = map.get(pluginId)
  if (!entry) return false

  if (
    entry.state === 'active' &&
    (activeRuntimeRegistries.has(pluginId) || isBackendOnlyExternalPlugin(pluginId))
  ) {
    return true
  }

  const activation = (async () => {
    clearPluginRuntimeContributions(pluginId)
    await stopPluginBackgroundServices(pluginId)

    const activated = entry.isBuiltin
      ? await activateBuiltinPluginModule(pluginId, activationGeneration, projectId)
      : await activateExternalPluginModule(
          pluginId,
          entry.manifest,
          activationGeneration,
          projectId,
        )

    return activated
  })()

  const activationRecord: ActivationRecord = {
    generation: activationGeneration,
    promise: activation,
  }
  activationRecord.promise = activation.finally(() => {
    if (activationPromises.get(pluginId) === activationRecord) {
      activationPromises.delete(pluginId)
    }
  })
  activationPromises.set(pluginId, activationRecord)
  return activationRecord.promise
}

export async function deactivatePluginById(pluginId: string): Promise<void> {
  let firstError: unknown = null
  const attempt = async (cleanup: () => Promise<void>) => {
    try {
      await cleanup()
    } catch (error) {
      firstError ??= error
    }
  }

  await attempt(() =>
    failPendingFrontendPluginCommands(
      pluginId,
      `Frontend runtime for Plugin ${pluginId} deactivated before the command completed`,
    ),
  )
  await attempt(() => deactivatePluginBackend(pluginId))
  bumpPluginFrontendReloadGeneration(pluginId)
  await attempt(() => destroyPluginBrowserSurfaces(pluginId))
  await attempt(() => deactivateLoadedPluginModule(pluginId))
  clearPluginRuntimeContributions(pluginId)
  await attempt(() => stopPluginBackgroundServices(pluginId))
  clearPluginHostSubscriptions(pluginId)
  clearPluginTaskInvalidationSubscriptions(pluginId)
  clearPluginRuntimeHostState(pluginId)
  setPluginRuntimeState(pluginId, 'installed', null)

  if (firstError !== null) throw firstError
}
