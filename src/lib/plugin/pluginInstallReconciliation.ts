import { get } from 'svelte/store'
import {
  getPlugin as getPluginIpc,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import {
  enabledPluginIds,
  disablePlugin as disablePluginInStore,
  enablePlugin as enablePluginInStore,
  installedPlugins,
  loadEnabledPluginIdsForProject,
} from './pluginStore'
import { activatePlugin, deactivatePluginById } from './pluginActivationLifecycle'
import { setPluginRuntimeError, upsertInstalledPlugin } from './pluginInstallState'
import { ensurePluginBackendReady } from './pluginHostCommands'

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await deactivatePluginById(pluginId)
  await uninstallPluginIpc(pluginId)
  installedPlugins.update(map => {
    const next = new Map(map)
    next.delete(pluginId)
    return next
  })
}

async function activateEnabledPlugin(pluginId: string): Promise<boolean> {
  const activated = await activatePlugin(pluginId)
  if (!activated) return false

  const entry = get(installedPlugins).get(pluginId)
  if (!entry?.manifest.backend) return true

  try {
    await ensurePluginBackendReady(pluginId)
    return true
  } catch (error) {
    setPluginRuntimeError(pluginId, error)
    return false
  }
}

export async function loadEnabledForProject(projectId: string): Promise<void> {
  await loadEnabledPluginIdsForProject(projectId)

  await Promise.all(Array.from(get(enabledPluginIds)).map(activateEnabledPlugin))
}

export async function enablePluginForProject(projectId: string, pluginId: string): Promise<boolean> {
  await enablePluginInStore(projectId, pluginId)
  return activateEnabledPlugin(pluginId)
}

export async function disablePluginForProject(projectId: string, pluginId: string): Promise<void> {
  await disablePluginInStore(projectId, pluginId)
  await deactivatePluginById(pluginId)
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

  return activateEnabledPlugin(pluginId)
}

async function reconcileLoadedPlugins(): Promise<void> {
  const enabled = get(enabledPluginIds)
  const installed = get(installedPlugins)
  const loadedPluginIds = Array.from(installed.entries())
    .filter(([, entry]) => entry.state === 'active')
    .map(([pluginId]) => pluginId)

  for (const pluginId of loadedPluginIds) {
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
