import { registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'

function registerTaskUiSectionPlugin(
  pluginId = 'plugin.task-context',
  sections: { id: string, order: number }[] = [{ id: 'context', order: 10 }],
): string {
  installedPlugins.set(new Map([[
    pluginId,
    {
      manifest: {
        id: pluginId,
        name: 'Task Context',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Task context test plugin',
        permissions: [],
        frontend: 'index.js',
        backend: null,
      },
      state: 'active',
      error: null,
    },
  ]]))
  enabledPluginIds.set(new Set([pluginId]))
  runtimeContributionSources.set(new Map([[
    pluginId,
    { pluginId, taskUISections: sections },
  ]]))
  for (const section of sections) {
    registerRenderableContributionComponent('taskUISections', `${pluginId}:${section.id}`, PluginSlotTestView)
  }
  return pluginId
}

export { registerTaskUiSectionPlugin }
