import { render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installedPluginEntry, defaultProps, resetSettingsViewTest } from './SettingsView.testUtils'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import { registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import SettingsView from './SettingsView.svelte'

describe('SettingsView plugin integration', () => {
  beforeEach(resetSettingsViewTest)


  it('renders plugin settings sections on the project settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.settings',
      {
        manifest: {
          id: 'plugin.settings',
          name: 'Settings Plugin',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Adds a settings section',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['plugin.settings']))
    runtimeContributionSources.set(new Map([[
      'plugin.settings',
      { pluginId: 'plugin.settings', settingsSections: [{ id: 'advanced', title: 'Advanced Plugin Settings' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:advanced', PluginSlotTestView)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Advanced Plugin Settings')).toBeTruthy()
      expect(document.querySelector('[data-slot-type="settingsSections"][data-slot-id="plugin.settings:advanced"]')).toBeTruthy()
    })
  })

  it('does not render a global-scoped settings section on the project settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.settings',
      {
        manifest: {
          id: 'plugin.settings',
          name: 'Settings Plugin',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Adds a settings section',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['plugin.settings']))
    runtimeContributionSources.set(new Map([[
      'plugin.settings',
      { pluginId: 'plugin.settings', settingsSections: [{ id: 'global-key', title: 'Global Key Section', scope: 'global' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:global-key', PluginSlotTestView)

    render(SettingsView, { props: defaultProps })

    // Give the project page a beat; the global-scoped section must never appear here.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Global Key Section')).toBeNull()
    expect(document.querySelector('[data-slot-id="plugin.settings:global-key"]')).toBeNull()
  })

  it('renders plugin settings sections in resolved order and preserves registration order for ties', async () => {
    enabledPluginIds.set(new Set(['plugin.zeta', 'plugin.alpha']))
    runtimeContributionSources.set(new Map([
      [
        'plugin.zeta',
        {
          pluginId: 'plugin.zeta',
          settingsSections: [
            { id: 'same-order-first', title: 'Same Order First', order: 10 },
            { id: 'later', title: 'Later', order: 30 },
          ],
        },
      ],
      [
        'plugin.alpha',
        {
          pluginId: 'plugin.alpha',
          settingsSections: [
            { id: 'same-order-second', title: 'Same Order Second', order: 10 },
            { id: 'default-order', title: 'Default Order' },
          ],
        },
      ],
    ]))

    for (const namespacedId of [
      'plugin.zeta:same-order-first',
      'plugin.zeta:later',
      'plugin.alpha:same-order-second',
      'plugin.alpha:default-order',
    ]) {
      registerRenderableContributionComponent('settingsSections', namespacedId, PluginSlotTestView)
    }

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      const renderedSlotIds = Array.from(document.querySelectorAll('[data-slot-type="settingsSections"]'))
        .map((element) => element.getAttribute('data-slot-id'))
      expect(renderedSlotIds).toEqual([
        'plugin.alpha:default-order',
        'plugin.zeta:same-order-first',
        'plugin.alpha:same-order-second',
        'plugin.zeta:later',
      ])
    })
  })

  it('renders plugin installation and inventory management on the global settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.global',
      installedPluginEntry('plugin.global', 'Global Plugin'),
    ]]))

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /install package/i })).toBeTruthy()
      expect(screen.getByText('Global Plugin')).toBeTruthy()
    })
    expect(screen.getByText('Install plugins app-wide. Projects enable installed plugins explicitly.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload plugin: global plugin/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /uninstall plugin: global plugin/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /enable for this project: global plugin/i })).toBeNull()
  })

  it('renders only project enablement controls for installed plugins on the project settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.project',
      installedPluginEntry('plugin.project', 'Project Plugin'),
    ]]))

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Project Plugin')).toBeTruthy()
    })
    expect(screen.queryByText('Install package')).toBeNull()
    expect(screen.getByText('Enable installed plugins for this project.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: /enable for this project: project plugin/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /reload plugin: project plugin/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /uninstall plugin: project plugin/i })).toBeNull()
  })

})
