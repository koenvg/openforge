import { get } from 'svelte/store'
import {
  getPlugin as getPluginIpc,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import { activeProjectId } from '../stores'
import {
  clearProjectEnabledPluginIds,
  enabledPluginIds,
  disableAppPlugin as disableAppPluginInStore,
  disablePlugin as disablePluginInStore,
  enableAppPlugin as enableAppPluginInStore,
  enablePlugin as enablePluginInStore,
  installedPlugins,
  loadEnabledAppPluginIds,
  loadEnabledPluginIdsForProject,
} from './pluginStore'
import { activatePlugin, deactivatePluginById } from './pluginActivationLifecycle'
import { installFromLocal, setPluginRuntimeError, upsertInstalledPlugin } from './pluginInstallState'
import { ensurePluginBackendReady, updatePluginBackendContext } from './pluginHostCommands'

const manualLifecyclePluginIds = new Set<string>()
let boundProjectRuntimeProjectId: string | null = null
let projectRuntimeTransition: Promise<void> = Promise.resolve()

async function deactivatePlugins(pluginIds: string[]): Promise<void> {
  let firstError: unknown = null
  for (const pluginId of pluginIds) {
    try {
      await deactivatePluginById(pluginId)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await deactivatePluginById(pluginId)
  await uninstallPluginIpc(pluginId)
  installedPlugins.update(map => {
    const next = new Map(map)
    next.delete(pluginId)
    return next
  })
}

export async function deactivateAllPlugins(): Promise<void> {
  const activePluginIds = Array.from(get(installedPlugins).entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)
    .reverse()
  await deactivatePlugins(activePluginIds)
}

async function activateEnabledPlugin(
  pluginId: string,
  projectId: string | null,
): Promise<boolean> {
  const wasActive = get(installedPlugins).get(pluginId)?.state === 'active'
  const activated = await activatePlugin(pluginId, projectId)
  if (!activated) return false

  const entry = get(installedPlugins).get(pluginId)
  if (wasActive || !entry?.manifest.backend) return true

  try {
    await ensurePluginBackendReady(pluginId, projectId)
    return true
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

async function transitionProjectScopedRuntime(projectId: string | null): Promise<void> {
  if (boundProjectRuntimeProjectId !== projectId || projectId === null) {
    const projectRuntimePluginIds = Array.from(get(installedPlugins).entries())
      .filter(([, entry]) =>
        entry.packageMetadata?.enablement !== 'app'
        && (entry.state === 'active' || entry.state === 'error'))
      .map(([pluginId]) => pluginId)
      .reverse()
    await deactivatePlugins(projectRuntimePluginIds)
  }

  if (projectId === null) {
    clearProjectEnabledPluginIds()
    boundProjectRuntimeProjectId = null
    return
  }

  await loadEnabledPluginIdsForProject(projectId)
  await Promise.all(Array.from(get(enabledPluginIds)).map((pluginId) =>
    activateEnabledPlugin(pluginId, projectId)))
  boundProjectRuntimeProjectId = projectId
}

async function transitionProjectRuntime(projectId: string | null): Promise<void> {
  let firstError: unknown = null
  try {
    await transitionProjectScopedRuntime(projectId)
  } catch (error) {
    firstError = error
  }

  try {
    await updateAppPluginContexts(projectId)
  } catch (error) {
    firstError ??= error
  }

  if (firstError) throw firstError
}

export async function loadEnabledForProject(projectId: string | null): Promise<void> {
  const transition = projectRuntimeTransition.then(() => transitionProjectRuntime(projectId))
  projectRuntimeTransition = transition.catch(() => undefined)
  return transition
}

export async function loadEnabledForApp(): Promise<void> {
  await loadEnabledAppPluginIds()
  const appPluginIds = Array.from(get(enabledPluginIds)).filter((pluginId) =>
    get(installedPlugins).get(pluginId)?.packageMetadata?.enablement === 'app')
  await Promise.all(appPluginIds.map((pluginId) =>
    activateEnabledPlugin(pluginId, get(activeProjectId))))
}

export async function updateAppPluginContexts(projectId: string | null): Promise<void> {
  const appBackendPluginIds = Array.from(get(installedPlugins).entries())
    .filter(([, entry]) =>
      entry.state === 'active'
      && entry.packageMetadata?.enablement === 'app'
      && entry.manifest.backend)
    .map(([pluginId]) => pluginId)
  await Promise.all(appBackendPluginIds.map((pluginId) =>
    updatePluginBackendContext(pluginId, projectId)))
}

export async function enablePluginForApp(pluginId: string): Promise<boolean> {
  const plugin = get(installedPlugins).get(pluginId)
  if (plugin?.packageMetadata?.enablement !== 'app') {
    throw new Error(`Plugin ${pluginId} does not use app enablement`)
  }
  await enableAppPluginInStore(pluginId)
  return activateEnabledPlugin(pluginId, get(activeProjectId))
}

export async function disablePluginForApp(pluginId: string): Promise<void> {
  manualLifecyclePluginIds.add(pluginId)
  try {
    await disableAppPluginInStore(pluginId)
    if (!get(enabledPluginIds).has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  } finally {
    manualLifecyclePluginIds.delete(pluginId)
    scheduleReconcile()
  }
}

export async function enablePluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await enablePluginInStore(projectId, pluginId)
  return activateEnabledPlugin(pluginId, projectId)
}

export async function disablePluginForProject(projectId: string, pluginId: string): Promise<void> {
  manualLifecyclePluginIds.add(pluginId)
  try {
    await disablePluginInStore(projectId, pluginId)
    if (!get(enabledPluginIds).has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  } finally {
    manualLifecyclePluginIds.delete(pluginId)
    scheduleReconcile()
  }
}

async function refreshInstalledPluginMetadata(pluginId: string): Promise<boolean> {
  const previousEntry = get(installedPlugins).get(pluginId)
  const refreshedPlugin = await getPluginIpc(pluginId)
  if (!refreshedPlugin) {
    installedPlugins.update(map => {
      const next = new Map(map)
      next.delete(pluginId)
      return next
    })
    return false
  }

  upsertInstalledPlugin(refreshedPlugin)

  if (previousEntry?.state === 'active') {
    installedPlugins.update(map => {
      const entry = map.get(pluginId)
      if (!entry) return map

      const next = new Map(map)
      next.set(pluginId, { ...entry, state: 'active', error: null })
      return next
    })
  }

  return true
}

export async function reloadInstalledPluginMetadata(pluginId: string): Promise<boolean> {
  return refreshInstalledPluginMetadata(pluginId)
}

export async function reloadPluginForApp(pluginId: string): Promise<boolean> {
  await deactivatePluginById(pluginId)
  const refreshed = await refreshInstalledPluginMetadata(pluginId)
  await loadEnabledAppPluginIds()
  if (!refreshed || !get(enabledPluginIds).has(pluginId)) return false
  return activateEnabledPlugin(pluginId, get(activeProjectId))
}

export async function reloadPluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await deactivatePluginById(pluginId)

  const refreshed = await refreshInstalledPluginMetadata(pluginId)
  if (!refreshed) {
    await loadEnabledPluginIdsForProject(projectId)
    return false
  }

  await loadEnabledPluginIdsForProject(projectId)

  if (!get(enabledPluginIds).has(pluginId)) {
    return false
  }

  return activateEnabledPlugin(pluginId, projectId)
}

/**
 * Re-apply a plugin that is installed straight from a folder on disk.
 *
 * Local installs point at the source folder rather than a managed copy, so a rebuild is
 * already on disk — but nothing picks it up on its own. The recorded row still carries the
 * metadata captured at install time, and the renderer still holds the module it imported
 * from the unchanged `plugin://` URL. Reinstalling refreshes the row; the reload cycle bumps
 * the frontend reload generation so the next import is cache-busted.
 *
 * With no active project there is nothing to reactivate into, but the generation bump is
 * renderer-wide, so whichever project is opened next imports the rebuilt bundle.
 *
 * Throws when the package on disk no longer installs (an unbuilt or broken rebuild).
 */
export async function reloadLocalPluginFromDisk(
  pluginId: string,
  sourcePath: string,
  projectId: string | null,
): Promise<void> {
  await installFromLocal(sourcePath, '')

  if (get(installedPlugins).get(pluginId)?.packageMetadata?.enablement === 'app') {
    await reloadPluginForApp(pluginId)
    return
  }

  if (!projectId) {
    await deactivatePluginById(pluginId)
    return
  }

  await reloadPluginForProject(projectId, pluginId)
}

async function reconcileLoadedPlugins(): Promise<void> {
  const enabled = get(enabledPluginIds)
  const installed = get(installedPlugins)
  const loadedPluginIds = Array.from(installed.entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)

  for (const pluginId of loadedPluginIds) {
    if (manualLifecyclePluginIds.has(pluginId)) continue
    if (!enabled.has(pluginId) || !installed.has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  }
}

// The reconcile subscribers below fire on every write to installedPlugins and enabledPluginIds,
// including the transient writes that happen mid-activation (e.g. setPluginRuntimeState). Because
// reconcile is async, firing it directly per write spawns overlapping passes that all read the same
// 'active' snapshot before any awaited deactivation lands, tearing a plugin down several times over
// (an activation/reconcile tug-of-war for backend-bearing plugins). Coalesce instead: schedule a
// single pass on a microtask, run at most one pass at a time, and re-run once more if any further
// store writes arrived while a pass was in flight (including reconcile's own state writes), so a
// burst of writes settles into a single teardown.
let reconcilePending = false
let reconcileInFlight: Promise<void> | null = null

async function drainReconcile(): Promise<void> {
  // Yield once so a synchronous burst of store writes coalesces into this single pass.
  await Promise.resolve()
  try {
    while (reconcilePending) {
      reconcilePending = false
      try {
        await reconcileLoadedPlugins()
      } catch (error) {
        // A failed deactivation must not wedge the loop or surface as an unhandled rejection.
        console.error('[pluginInstallReconciliation] reconcile pass failed:', error)
      }
    }
  } finally {
    reconcileInFlight = null
  }
}

function scheduleReconcile(): void {
  reconcilePending = true
  if (reconcileInFlight) return
  reconcileInFlight = drainReconcile()
}

enabledPluginIds.subscribe(() => {
  scheduleReconcile()
})

installedPlugins.subscribe(() => {
  scheduleReconcile()
})
