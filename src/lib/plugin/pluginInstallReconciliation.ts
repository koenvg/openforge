import { get } from 'svelte/store'
import {
  getPlugin as getPluginIpc,
  uninstallPlugin as uninstallPluginIpc,
} from '../ipc'
import { activeProjectId } from '../stores'
import {
  enabledPluginIds,
  disableAppPlugin as disableAppPluginInStore,
  enableAppPlugin as enableAppPluginInStore,
  installedPlugins,
  loadEnabledAppPluginIds,
  loadEnabledPluginIdsForProject,
} from './pluginStore'
import { deactivatePluginById } from './pluginActivationLifecycle'
import { activateEnabledPlugin, deactivatePlugins, withPluginLifecycleSuppressed } from './pluginEnablementLifecycle'
import { installFromLocal, upsertInstalledPlugin } from './pluginInstallState'

export {
  _resetProjectPluginReconciliationForTests,
  disablePluginForProject,
  enablePluginForProject,
  loadEnabledForProject,
  updateAppPluginContexts,
} from './projectPluginReconciliation'

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

export async function loadEnabledForApp(): Promise<void> {
  await loadEnabledAppPluginIds()
  const appPluginIds = Array.from(get(enabledPluginIds)).filter((pluginId) =>
    get(installedPlugins).get(pluginId)?.packageMetadata?.enablement === 'app')
  await Promise.all(appPluginIds.map((pluginId) =>
    activateEnabledPlugin(pluginId, get(activeProjectId))))
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
  await withPluginLifecycleSuppressed([pluginId], async () => {
    await disableAppPluginInStore(pluginId)
    if (!get(enabledPluginIds).has(pluginId)) {
      await deactivatePluginById(pluginId)
    }
  })
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
  const reload = async () => {
    await deactivatePluginById(pluginId)
    const refreshed = await refreshInstalledPluginMetadata(pluginId)
    await loadEnabledAppPluginIds()
    if (!refreshed || !get(enabledPluginIds).has(pluginId)) return false
    return activateEnabledPlugin(pluginId, get(activeProjectId))
  }
  const metadata = get(installedPlugins).get(pluginId)?.packageMetadata
  if (typeof document !== 'undefined' && metadata?.requires?.includes('themes')) {
    const { themeRegistry } = await import('../theme')
    return themeRegistry.withPluginReload(pluginId, reload)
  }
  return reload()
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
