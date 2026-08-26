import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import TerminalTaskPane from './TerminalTaskPane.svelte'

const TERMINAL_VIEW_ID = 'com.openforge.terminal:terminal'

function resetTaskDetailViewPluginSetup() {
  installedPlugins.set(new Map([[
    'com.openforge.terminal',
    {
      manifest: {
        id: 'com.openforge.terminal',
        name: 'Terminal',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Embedded terminal plugin',
        permissions: [],
        frontend: 'index.js',
        backend: null,
      },
      state: 'installed',
      error: null,
    },
  ]]))
  enabledPluginIds.set(new Set(['com.openforge.terminal']))
  runtimeContributionSources.set(new Map([[
    'com.openforge.terminal',
    { pluginId: 'com.openforge.terminal', taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }] },
  ]]))
  clearComponentRegistry()
  registerRenderableContributionComponent('taskPaneTabs', TERMINAL_VIEW_ID, TerminalTaskPane)
}

export { TERMINAL_VIEW_ID, resetTaskDetailViewPluginSetup }
