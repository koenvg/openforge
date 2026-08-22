import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import type { RuntimeContributionSource } from '../../lib/plugin/contributionResolver'
import type { PluginEntry } from '../../lib/plugin/types'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'

const { activatePluginMock } = vi.hoisted(() => ({
  activatePluginMock: vi.fn(async () => true),
}))

// The panel drives plugin lifecycle through pluginRegistry; stub it so no real plugin
// module is loaded. getPluginRenderProps is what the child PluginSlot uses to build a
// section component's props.
vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: activatePluginMock,
  enablePluginForApp: vi.fn(),
  disablePluginForApp: vi.fn(),
  getPluginRenderProps: () => ({ api: {}, context: {} }),
  enablePluginForProject: vi.fn(),
  installFromLocal: vi.fn(),
  installPluginFromGit: vi.fn(),
  installPluginFromNpm: vi.fn(),
  reloadInstalledPluginMetadata: vi.fn(),
  reloadPluginForApp: vi.fn(),
  reloadPluginForProject: vi.fn(),
  uninstallPlugin: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  writeClipboardText: vi.fn(),
  getConfig: vi.fn(async () => null),
  setConfig: vi.fn(),
  selectDirectory: vi.fn(async () => null),
  scanPluginFolder: vi.fn(async () => []),
}))

function entry(id: string, name: string): PluginEntry {
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
    state: 'active',
    error: null,
  } as PluginEntry
}

function sourceWithSection(pluginId: string, scope: 'project' | 'global'): RuntimeContributionSource {
  return {
    pluginId,
    settingsSections: [{ id: 'notes-settings', title: 'Notes', scope }],
  }
}

describe('GlobalPluginSettingsPanel', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
    vi.clearAllMocks()
  })

  it('offers the plugin folder alongside single-package installs', async () => {
    render(GlobalPluginSettingsPanel, { props: {} })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose plugin folder' })).toBeTruthy()
    })
  })

  it('does not activate a project-enabled plugin merely because Global Settings is open', () => {
    installedPlugins.set(new Map([['plugin.notes', entry('plugin.notes', 'Notes')]]))

    render(GlobalPluginSettingsPanel, { props: {} })

    expect(activatePluginMock).not.toHaveBeenCalled()
  })

  it('renders a plugin global-scoped settings section inside its card', async () => {
    installedPlugins.set(new Map([['plugin.notes', entry('plugin.notes', 'Notes')]]))
    runtimeContributionSources.set(new Map([['plugin.notes', sourceWithSection('plugin.notes', 'global')]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.notes:notes-settings', PluginSlotTestView)

    render(GlobalPluginSettingsPanel, { props: {} })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
      expect(document.querySelector('[data-slot-id="plugin.notes:notes-settings"]')).toBeTruthy()
    })
  })

  it('does not render a project-scoped section in the global card', async () => {
    installedPlugins.set(new Map([['plugin.notes', entry('plugin.notes', 'Notes')]]))
    runtimeContributionSources.set(new Map([['plugin.notes', sourceWithSection('plugin.notes', 'project')]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.notes:notes-settings', PluginSlotTestView)

    render(GlobalPluginSettingsPanel, { props: {} })

    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()
    expect(document.querySelector('[data-slot-id="plugin.notes:notes-settings"]')).toBeNull()
  })
})
