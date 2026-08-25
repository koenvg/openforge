import { fromStore } from 'svelte/store'
import { getGlobalPluginDefaults, setGlobalPluginDefault } from '../../lib/ipc'
import { resolveContributions } from '../../lib/plugin/contributionResolver'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { error } from '../../lib/stores'

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsPluginController() {
  const enabledPluginIdsState = fromStore(enabledPluginIds)
  const installedPluginsState = fromStore(installedPlugins)
  const runtimeContributionSourcesState = fromStore(runtimeContributionSources)
  let globalDefaults = $state<Map<string, boolean>>(new Map())

  const globalDefaultsById = $derived(
    new Map(
      Array.from(installedPluginsState.current.values()).map((plugin) => [
        plugin.manifest.id,
        globalDefaults.get(plugin.manifest.id) ?? (plugin.isBuiltin ?? false),
      ]),
    ),
  )
  const enabledContributionSources = $derived(
    Array.from(enabledPluginIdsState.current)
      .map((id) => runtimeContributionSourcesState.current.get(id))
      .filter((source) => source !== undefined),
  )
  const settingsSections = $derived(
    resolveContributions(enabledContributionSources).settingsSections.filter((section) => section.scope !== 'global'),
  )

  async function loadGlobalDefaults(): Promise<void> {
    try {
      const defaults = await getGlobalPluginDefaults()
      globalDefaults = new Map(defaults.map((item) => [item.pluginId, item.enabled]))
    } catch (value) {
      console.error('Failed to load global plugin defaults:', value)
    }
  }

  async function toggleGlobalDefault(pluginId: string, enabled: boolean): Promise<void> {
    try {
      await setGlobalPluginDefault(pluginId, enabled)
      const next = new Map(globalDefaults)
      next.set(pluginId, enabled)
      globalDefaults = next
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  return {
    get globalDefaultsById() { return globalDefaultsById },
    get settingsSections() { return settingsSections },
    loadGlobalDefaults,
    toggleGlobalDefault,
  }
}

export type SettingsPluginController = ReturnType<typeof createSettingsPluginController>
