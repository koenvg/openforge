import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import type { RuntimeContributionSource } from '../../lib/plugin/contributionResolver'
import type { PluginEntry } from '../../lib/plugin/types'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { themeRegistry } from '../../lib/theme'
import { LIGHT_THEME } from '../../lib/themeContract'

const { activatePluginMock, uninstallPluginMock } = vi.hoisted(() => ({
  activatePluginMock: vi.fn(async () => true),
  uninstallPluginMock: vi.fn(async () => undefined),
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
  uninstallPlugin: uninstallPluginMock,
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

  it('warns before installing that Trusted Plugins are not sandboxed, including theme CSS risks and recovery', () => {
    render(GlobalPluginSettingsPanel)

    expect(screen.getByText('Trusted Plugins')).toBeTruthy()
    expect(screen.getByText(/not sandboxed/)).toBeTruthy()
    expect(screen.getByText(/theme CSS can break layout or accessibility/)).toBeTruthy()
    expect(screen.getByText(/disable the owning plugin/)).toBeTruthy()
  })

  it('shows declared theme capabilities and registered theme ownership alongside legacy permissions', async () => {
    const plugin = entry('com.example.paper', 'Paper')
    plugin.manifest.permissions = ['read:files']
    plugin.packageMetadata = {
      id: 'com.example.paper', displayName: 'Paper', apiVersion: 1, description: 'Paper themes',
      enablement: 'app', frontend: 'index.js', requires: ['appEnablement', 'themes'],
    }
    installedPlugins.set(new Map([[plugin.manifest.id, plugin]]))
    const registration = themeRegistry.registerContributedTheme({
      ...LIGHT_THEME, id: 'com.example.paper:paper', label: 'Paper Light',
    }, { pluginId: 'com.example.paper', generation: 1 })
    try {
      render(GlobalPluginSettingsPanel)

      expect(screen.getByText('Capabilities:')).toBeTruthy()
      expect(screen.getByText('themes')).toBeTruthy()
      expect(screen.getByText('appEnablement')).toBeTruthy()
      expect(screen.getByText('read:files')).toBeTruthy()
      expect(screen.getByText('Paper Light')).toBeTruthy()
      expect(screen.getByText('Provided by com.example.paper')).toBeTruthy()
      expect(screen.getByRole('switch', { name: 'Enabled throughout OpenForge: Paper' })).toBeTruthy()
      expect(screen.queryByRole('switch', { name: 'Enable by default: Paper' })).toBeNull()

      await registration.dispose()
      await waitFor(() => expect(screen.queryByText('Paper Light')).toBeNull())
      expect(screen.getByText('themes')).toBeTruthy()
    } finally {
      await registration.dispose()
    }
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

  it('warns that uninstalling deletes the plugin\'s data before doing it', async () => {
    installedPlugins.set(new Map([['plugin.notes', entry('plugin.notes', 'Notes')]]))

    render(GlobalPluginSettingsPanel, { props: {} })

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Notes' }))

    expect(screen.getByText(/deletes all saved data.*in every project/i)).toBeTruthy()
    expect(uninstallPluginMock).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm uninstall plugin: Notes' }))

    expect(uninstallPluginMock).toHaveBeenCalledWith('plugin.notes')
  })

  it('cancels the uninstall without deleting anything', async () => {
    installedPlugins.set(new Map([['plugin.notes', entry('plugin.notes', 'Notes')]]))

    render(GlobalPluginSettingsPanel, { props: {} })

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Notes' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(uninstallPluginMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Uninstall plugin: Notes' })).toBeTruthy()
  })
})
