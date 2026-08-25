import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return {
    ...settingsViewRenderIpc,
    installPluginFromLocal: vi.fn(),
    installPluginFromNpm: vi.fn(),
    installPluginFromGit: vi.fn(),
    uninstallPlugin: vi.fn(),
    getPlugin: vi.fn(),
    setPluginEnabled: vi.fn(),
    getEnabledPlugins: vi.fn(() => Promise.resolve([])),
  }
})

export function installedPluginEntry(id: string, name: string) {
  return {
    manifest: {
      id,
      name,
      version: '1.0.0',
      apiVersion: 1,
      description: `${name} description`,
      permissions: [],
      frontend: 'index.js',
      backend: null,
    },
    state: 'installed' as const,
    error: null,
    installPath: `/plugins/${id}`,
    isBuiltin: false,
    sourceKind: 'local',
    sourceSpec: `/plugins/${id}`,
  }
}

export async function resetSettingsViewPluginTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()

  const [{ clearComponentRegistry }, { enabledPluginIds, installedPlugins, runtimeContributionSources }] = await Promise.all([
    import('../../lib/plugin/componentRegistry'),
    import('../../lib/plugin/pluginStore'),
  ])
  installedPlugins.set(new Map())
  enabledPluginIds.set(new Set())
  runtimeContributionSources.set(new Map())
  clearComponentRegistry()
}
