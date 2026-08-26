import { describe, expect, it, vi } from 'vitest'
import type { ResolvedContributions } from './plugin/contributionResolver'
import type { ShortcutHandler, ShortcutRegistry } from './shortcuts.svelte'
import { createAppPluginController } from './appPluginController'

function contributions(overrides: Partial<ResolvedContributions> = {}): ResolvedContributions {
  return {
    views: [],
    taskPaneTabs: [],
    taskUISections: [],
    reviewRowActions: [],
    commands: [],
    settingsSections: [],
    backgroundServices: [],
    ...overrides,
  }
}

function shortcutRegistry() {
  const handlers = new Map<string, ShortcutHandler>()
  const registry: ShortcutRegistry = {
    register: vi.fn((key, handler) => { handlers.set(key, handler) }),
    unregister: vi.fn((key) => { handlers.delete(key) }),
    handleKeydown: vi.fn(),
  }
  return { handlers, registry }
}

describe('App plugin controller', () => {
  it('owns plugin shortcuts and removes stale registrations', () => {
    const navigate = vi.fn()
    const executePluginCommand = vi.fn()
    const { handlers, registry } = shortcutRegistry()
    const controller = createAppPluginController({
      navigate,
      executePluginCommand,
      activatePlugin: vi.fn(),
      deactivateAllPlugins: vi.fn(),
      loadEnabledForProject: vi.fn(),
    })
    controller.setShortcutRegistry(registry)

    controller.syncContributions(contributions({
      views: [{
        pluginId: 'files',
        contributionId: 'browser',
        namespacedId: 'files:browser',
        title: 'Files',
        icon: 'folder-open',
        shortcut: '⌘o',
        navigationComponent: undefined,
        showInRail: true,
        showInSidebar: false,
        railOrder: 10,
      }],
      commands: [{
        pluginId: 'github',
        contributionId: 'refresh',
        namespacedId: 'github:refresh',
        title: 'Refresh',
        shortcut: '⌘r',
        discoverable: true,
      }],
    }))

    handlers.get('⌘o')?.(new KeyboardEvent('keydown'))
    handlers.get('⌘r')?.(new KeyboardEvent('keydown'))

    expect(navigate).toHaveBeenCalledWith('plugin:files:browser')
    expect(executePluginCommand).toHaveBeenCalledWith('github', 'refresh')

    controller.syncContributions(contributions({
      commands: [{
        pluginId: 'github',
        contributionId: 'refresh',
        namespacedId: 'github:refresh',
        title: 'Refresh',
        shortcut: '⌘r',
        discoverable: true,
      }],
    }))

    expect(registry.unregister).toHaveBeenCalledWith('⌘o')
    expect(handlers.has('⌘o')).toBe(false)
  })

  it('loads each visible project once and owns plugin teardown', () => {
    const loadEnabledForProject = vi.fn()
    const activatePlugin = vi.fn()
    const deactivateAllPlugins = vi.fn()
    const { registry } = shortcutRegistry()
    const controller = createAppPluginController({
      navigate: vi.fn(),
      executePluginCommand: vi.fn(),
      activatePlugin,
      deactivateAllPlugins,
      loadEnabledForProject,
    })
    controller.setShortcutRegistry(registry)

    controller.selectProject('P-1')
    controller.selectProject('P-1')
    controller.syncContributions(contributions({
      backgroundServices: [{
        pluginId: 'github',
        contributionId: 'poller',
        namespacedId: 'github:poller',
        scope: 'global',
      }],
    }))
    controller.selectProject(null)
    controller.dispose()

    expect(loadEnabledForProject.mock.calls).toEqual([['P-1'], [null]])
    expect(activatePlugin).toHaveBeenCalledWith('github')
    expect(registry.unregister).toHaveBeenCalledTimes(0)
    expect(deactivateAllPlugins).toHaveBeenCalledOnce()
  })
})
