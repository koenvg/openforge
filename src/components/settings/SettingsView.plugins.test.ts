import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultProps } from './SettingsView.testUtils'
import { installedPluginEntry, resetSettingsViewPluginTest } from './SettingsView.plugins.testFixture'
import { settingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import { registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import SettingsView from './SettingsView.svelte'

describe('SettingsView plugin integration', () => {
  beforeEach(resetSettingsViewPluginTest)

  async function openPluginsCategory() {
    await fireEvent.click(screen.getByRole('button', { name: /^Plugins/ }))
  }

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
    await openPluginsCategory()

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
    await openPluginsCategory()

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
    await openPluginsCategory()

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

  it('shows and retains an unavailable app-wide dashboard default', async () => {
    settingsViewRenderIpc.getConfig.mockImplementation(async (key: string) =>
      key === 'project_dashboard_provider' ? 'missing-plugin.dashboard' : null,
    )

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openPluginsCategory()

    const select = await screen.findByRole('combobox', { name: 'Default project dashboard' }) as HTMLSelectElement
    expect(select.value).toBe('missing-plugin.dashboard')
    expect(screen.getByRole('option', { name: 'missing-plugin.dashboard (unavailable)' })).toBeTruthy()
    expect(settingsViewRenderIpc.setConfig).not.toHaveBeenCalled()
  })

  it('disables project provider selection until its stored preference has loaded', async () => {
    let resolvePreference!: (value: string | null) => void
    settingsViewRenderIpc.getProjectConfig.mockImplementation(async (_projectId: string, key: string) => {
      if (key !== 'project_dashboard_provider') return null
      return new Promise<string | null>((resolve) => {
        resolvePreference = resolve
      })
    })

    render(SettingsView, { props: defaultProps })
    await openPluginsCategory()

    const select = await screen.findByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    expect(select.disabled).toBe(true)

    resolvePreference('core')
    await vi.waitFor(() => expect(select.disabled).toBe(false))
  })

  it('keeps an unavailable project override visible and lets the project return to inheritance', async () => {
    settingsViewRenderIpc.getProjectConfig.mockImplementation(async (_projectId: string, key: string) =>
      key === 'project_dashboard_provider' ? 'missing-plugin.dashboard' : null,
    )

    render(SettingsView, { props: defaultProps })
    await openPluginsCategory()

    const select = await screen.findByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    expect(select.value).toBe('missing-plugin.dashboard')
    expect(screen.getByRole('option', { name: 'missing-plugin.dashboard (unavailable)' })).toBeTruthy()

    await fireEvent.change(select, { target: { value: 'inherit' } })
    await vi.waitFor(() => {
      expect(settingsViewRenderIpc.clearProjectConfig).toHaveBeenCalledWith(
        'test-project-id',
        'project_dashboard_provider',
      )
    })
  })

  it('renders plugin installation and inventory management on the global settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.global',
      installedPluginEntry('plugin.global', 'Global Plugin'),
    ]]))

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openPluginsCategory()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /install package/i })).toBeTruthy()
      expect(screen.getAllByText('Global Plugin').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Install packages here. App-owned plugins are enabled once; project-owned plugins are enabled per Project.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload plugin: global plugin/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /uninstall plugin: global plugin/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /enable for this project: global plugin/i })).toBeNull()

    // Enable-by-default lives only in the dedicated plugin panel now — it must not
    // be duplicated inside the grouped Configuration card.
    expect(screen.queryByRole('switch', { name: /toggle plugin default: global plugin/i })).toBeNull()
    expect(screen.getByRole('switch', { name: /enable by default: global plugin/i })).toBeTruthy()
  })

  it('renders only project enablement controls for installed plugins on the project settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.project',
      installedPluginEntry('plugin.project', 'Project Plugin'),
    ]]))

    render(SettingsView, { props: defaultProps })
    await openPluginsCategory()

    await vi.waitFor(() => {
      // Rendered by both the shared configuration card and the plugin panel.
      expect(screen.getAllByText('Project Plugin').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Install package')).toBeNull()
    expect(screen.getByText('Enable installed plugins for this project.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: /enable for this project: project plugin/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /reload plugin: project plugin/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /uninstall plugin: project plugin/i })).toBeNull()
  })

})
