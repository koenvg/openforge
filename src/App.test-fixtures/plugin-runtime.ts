import { vi } from 'vitest'
import type { RuntimeContributionSource } from '../lib/plugin/contributionResolver'

export const installedPluginRows: Array<{
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string
  contributes: string
  frontendEntry: string
  backendEntry: string | null
  installPath: string
  installedAt: number
  isBuiltin: boolean
}> = []

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

export function persistInstalledPluginRow(plugin: {
  id: string
  name: string
  version: string
  apiVersion: number
  description: string
  permissions: string
  contributes: string
  frontendEntry: string
  backendEntry: string | null
  installPath: string
  installedAt: number
  isBuiltin: boolean
}) {
  const nextRow = {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    description: plugin.description,
    permissions: plugin.permissions,
    contributes: plugin.contributes,
    frontendEntry: plugin.frontendEntry,
    backendEntry: plugin.backendEntry,
    installPath: plugin.installPath,
    installedAt: plugin.installedAt,
    isBuiltin: plugin.isBuiltin,
  }

  const existingIndex = installedPluginRows.findIndex((row) => row.id === plugin.id)
  if (existingIndex >= 0) {
    installedPluginRows.splice(existingIndex, 1, nextRow)
  } else {
    installedPluginRows.push(nextRow)
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

export async function resetPluginRuntimeFixtures() {
  installedPluginRows.length = 0

  const pluginStore = await import('../lib/plugin/pluginStore')
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
