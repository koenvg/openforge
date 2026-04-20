import { describe, expect, it } from 'vitest'

import { resolveContributions, resolveContributionsForSlot } from './contributionResolver'
import type {
  PluginBackgroundService,
  PluginCommandContribution,
  PluginContributionPoints,
  PluginManifest,
  PluginSettingsSection,
  PluginSidebarPanelContribution,
  PluginTaskPaneTabContribution,
  PluginViewContribution,
} from './types'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'plugin.test',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    contributes: {},
    frontend: 'dist/index.js',
    backend: null,
    ...overrides,
  }
}

function makeView(overrides: Partial<PluginViewContribution> = {}): PluginViewContribution {
  return {
    id: 'main',
    title: 'Main View',
    icon: 'plug',
    ...overrides,
  }
}

function makeTab(overrides: Partial<PluginTaskPaneTabContribution> = {}): PluginTaskPaneTabContribution {
  return {
    id: 'details',
    title: 'Details',
    ...overrides,
  }
}

function makePanel(overrides: Partial<PluginSidebarPanelContribution> = {}): PluginSidebarPanelContribution {
  return {
    id: 'inspector',
    title: 'Inspector',
    side: 'right',
    ...overrides,
  }
}

function makeCommand(overrides: Partial<PluginCommandContribution> = {}): PluginCommandContribution {
  return {
    id: 'open',
    title: 'Open',
    ...overrides,
  }
}

function makeSettingsSection(overrides: Partial<PluginSettingsSection> = {}): PluginSettingsSection {
  return {
    id: 'general',
    title: 'General',
    ...overrides,
  }
}

function makeBackgroundService(overrides: Partial<PluginBackgroundService> = {}): PluginBackgroundService {
  return {
    id: 'sync',
    name: 'Sync Service',
    ...overrides,
  }
}

describe('resolveContributions', () => {
  it('resolves views from a single plugin', () => {
    const manifest = makeManifest({
      id: 'plugin.alpha',
      contributes: {
        views: [
          makeView({ id: 'one', title: 'One' }),
          makeView({ id: 'two', title: 'Two', icon: 'folder-open' }),
        ],
      },
    })

    const result = resolveContributions([manifest])

    expect(result.views).toHaveLength(2)
    expect(result.views).toEqual([
      expect.objectContaining({
        pluginId: 'plugin.alpha',
        contributionId: 'one',
        namespacedId: 'plugin.alpha:one',
        title: 'One',
      }),
      expect.objectContaining({
        pluginId: 'plugin.alpha',
        contributionId: 'two',
        namespacedId: 'plugin.alpha:two',
        title: 'Two',
      }),
    ])
  })

  it('resolves views from multiple plugins', () => {
    const pluginA = makeManifest({
      id: 'plugin.a',
      contributes: { views: [makeView({ id: 'main', title: 'Plugin A' })] },
    })
    const pluginB = makeManifest({
      id: 'plugin.b',
      contributes: { views: [makeView({ id: 'main', title: 'Plugin B', icon: 'folder-open' })] },
    })

    const result = resolveContributions([pluginA, pluginB])

    expect(result.views).toHaveLength(2)
    expect(result.views.map((view) => view.namespacedId)).toEqual(['plugin.a:main', 'plugin.b:main'])
  })

  it('resolves task-pane tabs', () => {
    const manifest = makeManifest({
      id: 'plugin.tabs',
      contributes: {
        taskPaneTabs: [makeTab({ id: 'activity', title: 'Activity', icon: 'sparkles', order: 5 })],
      },
    })

    const result = resolveContributions([manifest])

    expect(result.taskPaneTabs).toEqual([
      {
        pluginId: 'plugin.tabs',
        contributionId: 'activity',
        namespacedId: 'plugin.tabs:activity',
        title: 'Activity',
        icon: 'sparkles',
        order: 5,
      },
    ])
  })

  it('handles empty contributions gracefully', () => {
    const result = resolveContributions([makeManifest({ contributes: {} })])

    expect(result).toEqual({
      views: [],
      taskPaneTabs: [],
      sidebarPanels: [],
      commands: [],
      settingsSections: [],
      backgroundServices: [],
    })
  })

  it('handles undefined contributes gracefully', () => {
    const manifest = makeManifest()
    Reflect.deleteProperty(manifest, 'contributes')

    const result = resolveContributions([manifest])

    expect(result).toEqual({
      views: [],
      taskPaneTabs: [],
      sidebarPanels: [],
      commands: [],
      settingsSections: [],
      backgroundServices: [],
    })
  })

  it('handles duplicate slot contributions by namespacing', () => {
    const pluginA = makeManifest({
      id: 'plugin-a',
      contributes: { views: [makeView({ id: 'main', title: 'Main A' })] },
    })
    const pluginB = makeManifest({
      id: 'plugin-b',
      contributes: { views: [makeView({ id: 'main', title: 'Main B' })] },
    })

    const result = resolveContributions([pluginA, pluginB])

    expect(result.views.map((view) => view.namespacedId)).toEqual(['plugin-a:main', 'plugin-b:main'])
  })

  it('filters views with invalid icons', () => {
    const manifest = makeManifest({
      contributes: {
        views: [makeView({ id: 'bad', icon: 'nonexistent' }), makeView({ id: 'good', icon: 'plug' })],
      },
    })

    const result = resolveContributions([manifest])

    expect(result.views).toHaveLength(1)
    expect(result.views[0]?.contributionId).toBe('good')
  })

  it('normalizes view shortcuts', () => {
    const manifest = makeManifest({
      contributes: { views: [makeView({ shortcut: 'Cmd+O' })] },
    })

    const result = resolveContributions([manifest])

    expect(result.views[0]?.shortcut).toBe('⌘o')
  })

  it('defaults showInRail to true', () => {
    const manifest = makeManifest({
      contributes: { views: [makeView()] },
    })

    const result = resolveContributions([manifest])

    expect(result.views[0]?.showInRail).toBe(true)
  })

  it('defaults railOrder to 100', () => {
    const manifest = makeManifest({
      contributes: { views: [makeView()] },
    })

    const result = resolveContributions([manifest])

    expect(result.views[0]?.railOrder).toBe(100)
  })

  it('skips malformed contributions missing required id', () => {
    const malformedView = makeView({ title: 'Broken' })
    Reflect.deleteProperty(malformedView, 'id')

    const manifest = makeManifest({
      contributes: {
        views: [malformedView, makeView({ id: 'valid', title: 'Valid' })],
      },
    })

    const result = resolveContributions([manifest])

    expect(result.views).toHaveLength(1)
    expect(result.views[0]?.contributionId).toBe('valid')
  })

  it('resolves all contribution types in one call', () => {
    const contributions: PluginContributionPoints = {
      views: [makeView({ id: 'view' })],
      taskPaneTabs: [makeTab({ id: 'tab' })],
      sidebarPanels: [makePanel({ id: 'panel', side: 'left', order: 2 })],
      commands: [makeCommand({ id: 'command', shortcut: 'Cmd+K' })],
      settingsSections: [makeSettingsSection({ id: 'settings' })],
      backgroundServices: [makeBackgroundService({ id: 'service', name: 'Worker' })],
    }
    const manifest = makeManifest({ id: 'plugin.all', contributes: contributions })

    const result = resolveContributions([manifest])

    expect(result.views).toHaveLength(1)
    expect(result.taskPaneTabs).toHaveLength(1)
    expect(result.sidebarPanels).toHaveLength(1)
    expect(result.commands).toHaveLength(1)
    expect(result.settingsSections).toHaveLength(1)
    expect(result.backgroundServices).toHaveLength(1)
    expect(result.backgroundServices[0]?.namespacedId).toBe('plugin.all:service')
  })
})

describe('resolveContributionsForSlot', () => {
  it('matches contributions by contributionId or namespacedId', () => {
    const resolved = resolveContributions([
      makeManifest({
        id: 'plugin.slot',
        contributes: {
          views: [makeView({ id: 'main' })],
          taskPaneTabs: [makeTab({ id: 'details' })],
        },
      }),
    ])

    expect(resolveContributionsForSlot(resolved, 'views', 'main')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'views', 'plugin.slot:main')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'taskPaneTabs', 'plugin.slot:details')).toHaveLength(1)
    expect(resolveContributionsForSlot(resolved, 'views', 'missing')).toEqual([])
  })
})
