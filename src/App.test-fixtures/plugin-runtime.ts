import { vi } from 'vitest'
import type { RuntimeContributionSource } from '../lib/plugin/contributionResolver'
import { installedPluginRows } from './ipc'

function builtinRuntimeContributionSourceForTest(
  pluginId: string,
): Omit<RuntimeContributionSource, 'pluginId'> {
  switch (pluginId) {
    case 'com.openforge.file-viewer':
      return {
        views: [
          {
            id: 'files',
            title: 'Files',
            icon: 'folder-open',
            placement: 'rail',
            order: 10,
            shortcut: 'Cmd+O',
          },
        ],
      }
    case 'com.openforge.github-sync':
      return {
        views: [
          {
            id: 'pr_review',
            title: 'Pull Requests',
            icon: 'git-pull-request',
            placement: 'rail',
            order: 20,
            shortcut: 'Cmd+G',
          },
        ],
        commands: [{ id: 'refresh', title: 'Refresh Pull Requests', shortcut: 'Cmd+Shift+R' }],
      }
    case 'com.openforge.task-schedules':
      return {
        views: [
          {
            id: 'schedules',
            title: 'Task Schedules',
            icon: 'clock',
            placement: 'rail',
            order: 50,
            shortcut: 'Cmd+S',
          },
        ],
      }
    case 'com.openforge.terminal':
      return {
        views: [
          {
            id: 'terminal',
            title: 'Terminal',
            icon: 'terminal',
            placement: 'rail',
            order: 40,
            shortcut: 'Cmd+J',
          },
        ],
        taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }],
      }
    default:
      return {}
  }
}


const {
  mockActivatePlugin,
  mockExecutePluginCommand,
  mockLoadEnabledForApp,
  mockLoadEnabledForProject,
} = vi.hoisted(() => ({
  mockActivatePlugin: vi.fn<(pluginId: string) => Promise<boolean>>(async () => true),
  mockExecutePluginCommand: vi.fn(async (_pluginId: string, _commandId: string) => true),
  mockLoadEnabledForApp: vi.fn<() => Promise<void>>(async () => undefined),
  mockLoadEnabledForProject: vi.fn<(projectId: string) => Promise<void>>(async () => undefined),
}))

export {
  mockActivatePlugin,
  mockExecutePluginCommand,
  mockLoadEnabledForApp,
  mockLoadEnabledForProject,
}

vi.mock('../lib/plugin/pluginRegistry', async () => {
  const actual = await vi.importActual<typeof import('../lib/plugin/pluginRegistry')>(
    '../lib/plugin/pluginRegistry',
  )
  return {
    ...actual,
    activatePlugin: mockActivatePlugin,
    deactivateAllPlugins: vi.fn(async () => undefined),
    executePluginCommand: mockExecutePluginCommand,
    loadEnabledForApp: mockLoadEnabledForApp,
    loadEnabledForProject: mockLoadEnabledForProject,
    updateAppPluginContexts: vi.fn(async () => undefined),
  }
})

export async function activateGithubGlobalView(): Promise<void> {
  const pluginStore = await import('../lib/plugin/pluginStore')
  const pluginRegistry = await import('../lib/plugin/pluginRegistry')
  const { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_ID } = await import('../lib/githubSyncPlugin')
  const { tick } = await import('svelte')

  pluginStore.enabledPluginIds.set(new Set([GITHUB_SYNC_PLUGIN_ID]))
  await pluginRegistry.activatePlugin(GITHUB_SYNC_PLUGIN_ID)
  pluginStore.setRuntimeContributionSource(GITHUB_SYNC_PLUGIN_ID, {
    views: [
      {
        id: GITHUB_SYNC_GLOBAL_VIEW_ID,
        title: 'All Pull Requests',
        icon: 'git-pull-request',
        placement: 'sidebar',
        order: 20,
      },
    ],
  })
  await tick()
}

export async function resetPluginRuntimeFixtures() {
  const pluginStore = await import('../lib/plugin/pluginStore')
  const { clearComponentRegistry } = await import('../lib/plugin/componentRegistry')
  clearComponentRegistry()
  const { clearProjectDashboardProviderIds } = await import('../lib/plugin/projectDashboardProviders')
  clearProjectDashboardProviderIds()
  const { clearTaskDetailProviderIds } = await import('../lib/plugin/taskDetailProviders')
  clearTaskDetailProviderIds()
  pluginStore.installedPlugins.set(new Map())
  pluginStore.appEnabledPluginIds.set(new Set())
  pluginStore.projectEnabledPluginIds.set(new Set())
  pluginStore.enabledPluginIds.set(new Set())
  pluginStore.runtimeContributionSources.set(new Map())
  pluginStore.loading.set(false)
  pluginStore.error.set(null)

  mockActivatePlugin.mockImplementation(async (pluginId: string) => {
    const { setRuntimeContributionSource } = await import('../lib/plugin/pluginStore')
    setRuntimeContributionSource(pluginId, builtinRuntimeContributionSourceForTest(pluginId))
    return true
  })
  mockLoadEnabledForProject.mockImplementation(async () => {
    const { enabledPluginIds } = await import('../lib/plugin/pluginStore')
    const pluginIds = installedPluginRows.map((row) => row.id)
    enabledPluginIds.set(new Set(pluginIds))
    for (const pluginId of pluginIds) {
      await mockActivatePlugin(pluginId)
    }
  })
}
