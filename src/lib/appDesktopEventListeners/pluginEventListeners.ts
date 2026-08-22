import { get } from 'svelte/store'
import { loadEnabledForApp, loadEnabledForProject, reloadInstalledPluginMetadata, reloadPluginForApp, reloadPluginForProject } from '../plugin/pluginRegistry'
import { installedPlugins } from '../plugin/pluginStore'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type PluginEventDeps = Pick<
  AppDesktopEventDeps,
  | 'getActiveProjectId'
  | 'reloadInstalledPluginMetadata'
  | 'reloadPluginForApp'
  | 'reloadPluginForProject'
  | 'loadEnabledPluginsForApp'
  | 'loadEnabledPluginsForProject'
>

export function createPluginEventListeners(deps: PluginEventDeps) {
  return {
    pluginInstallationChanged: defineDesktopEventListener<{ plugin_id: string }>(
      'plugin-installation-changed',
      async (event) => {
        const pluginId = event.payload.plugin_id
        try {
          await (deps.reloadInstalledPluginMetadata ?? reloadInstalledPluginMetadata)(pluginId)
        } catch (e) {
          console.error('[plugins] Failed to refresh installed plugin from sidecar event:', pluginId, e)
        }
      },
    ),

    appPluginEnablementChanged: defineDesktopEventListener<{
      plugin_id: string
      enabled: boolean
    }>('app-plugin-enablement-changed', async (event) => {
      try {
        await (deps.loadEnabledPluginsForApp ?? loadEnabledForApp)()
      } catch (error) {
        console.error('[plugins] Failed to refresh app plugin enablement from sidecar event:', event.payload.plugin_id, error)
      }
    }),

    projectPluginEnablementChanged: defineDesktopEventListener<{
      plugin_id: string
      project_id: string
      enabled: boolean
    }>('project-plugin-enablement-changed', async (event) => {
      const projectId = event.payload.project_id
      if ((deps.getActiveProjectId?.() ?? projectId) !== projectId) return
      try {
        await (deps.loadEnabledPluginsForProject ?? loadEnabledForProject)(projectId)
      } catch (e) {
        console.error('[plugins] Failed to refresh project plugin enablement from sidecar event:', projectId, e)
      }
    }),

    pluginReloadRequested: defineDesktopEventListener<{
      plugin_id: string
      project_id?: string | null
    }>('plugin-reload-requested', async (event) => {
      const pluginId = event.payload.plugin_id
      const projectId = deps.getActiveProjectId?.() ?? null
      try {
        if (get(installedPlugins).get(pluginId)?.packageMetadata?.enablement === 'app') {
          await (deps.reloadPluginForApp ?? reloadPluginForApp)(pluginId)
        } else if (projectId) {
          await (deps.reloadPluginForProject ?? reloadPluginForProject)(projectId, pluginId)
        } else {
          await (deps.reloadInstalledPluginMetadata ?? reloadInstalledPluginMetadata)(pluginId)
        }
      } catch (e) {
        console.error('[plugins] Failed to reload plugin from sidecar request:', pluginId, e)
      }
    }),
  }
}
