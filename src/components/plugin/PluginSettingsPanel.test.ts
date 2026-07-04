import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'
import PluginSettingsPanel from './PluginSettingsPanel.svelte'
import { installedPlugins, enabledPluginIds, error as pluginLoadError } from '../../lib/plugin/pluginStore'
import {
  disablePluginForProject,
  enablePluginForProject,
  installFromLocal,
  installPluginFromGit,
  installPluginFromNpm,
  reloadInstalledPluginMetadata,
  reloadPluginForProject,
  uninstallPlugin,
} from '../../lib/plugin/pluginRegistry'
import { writeClipboardText } from '../../lib/ipc'
import type { PluginEntry } from '../../lib/plugin/types'

vi.mock('../../lib/plugin/pluginStore', () => {
  const { writable } = require('svelte/store')
  return {
    installedPlugins: writable(new Map()),
    enabledPluginIds: writable(new Set()),
    error: writable(null),
  }
})

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  enablePluginForProject: vi.fn(),
  disablePluginForProject: vi.fn(),
  installFromLocal: vi.fn(),
  installPluginFromGit: vi.fn(),
  installPluginFromNpm: vi.fn(),
  reloadInstalledPluginMetadata: vi.fn(),
  reloadPluginForProject: vi.fn(),
  uninstallPlugin: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  writeClipboardText: vi.fn(),
}))

const mockPlugin: PluginEntry = {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A test plugin',
    permissions: ['read:files'],
    frontend: 'index.js',
    backend: null,
  },
  state: 'installed',
  error: null,
  installPath: '/plugins/test-plugin',
  sourceKind: 'npm',
  sourceSpec: 'npm:@acme/test-plugin@1.0.0',
  installedAt: 1234,
}

describe('PluginSettingsPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()

    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    pluginLoadError.set(null)
  })

  it('renders project empty state when no app-wide plugins are installed', () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    expect(screen.getByText('Project plugins')).toBeTruthy()
    expect(screen.getByText('Enable installed plugins for this project.')).toBeTruthy()
    expect(screen.getByText('No plugins installed app-wide')).toBeTruthy()
  })

  it('renders only per-project enablement metadata for installed plugins', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    expect(screen.getByText('Test Plugin')).toBeTruthy()
    expect(screen.getByText('A test plugin')).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.queryByText('Installed app-wide')).toBeNull()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    expect(screen.queryByText('test-plugin')).toBeNull()
    expect(screen.queryByText('npm:@acme/test-plugin@1.0.0')).toBeNull()
    expect(screen.queryByText('read:files')).toBeNull()
  })

  it('uses native disabled semantics for project enablement switches when disabled', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(PluginSettingsPanel, { projectId: 'proj-1', disabled: true })

    expect((screen.getByPlaceholderText('Search plugins') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'Enable for this project: Test Plugin' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Install package' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reload plugin: Test Plugin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall plugin: Test Plugin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy diagnostics: Test Plugin' })).toBeNull()
  })

  it('enables and disables plugins through explicit project controls', async () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    await fireEvent.click(screen.getByRole('switch', { name: 'Enable for this project: Test Plugin' }))
    expect(enablePluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
    expect(installPluginFromNpm).not.toHaveBeenCalled()

    enabledPluginIds.set(new Set(['test-plugin']))
    await fireEvent.click(await screen.findByRole('switch', { name: 'Disable for this project: Test Plugin' }))
    expect(disablePluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
  })

  it('shows load and project enablement errors', async () => {
    vi.mocked(enablePluginForProject).mockRejectedValue(new Error('enable failed'))
    pluginLoadError.set('Failed to list plugins')
    installedPlugins.set(new Map([['test-plugin', { ...mockPlugin, state: 'error', error: 'activation failed' }]]))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    expect(screen.getByText('Failed to list plugins')).toBeTruthy()
    expect(screen.getByText('activation failed')).toBeTruthy()

    await fireEvent.click(screen.getByRole('switch', { name: 'Enable for this project: Test Plugin' }))
    expect(screen.getByText('enable failed')).toBeTruthy()
  })

  it('filters project plugins by search text and status chips', async () => {
    const disabledPlugin = { ...mockPlugin, manifest: { ...mockPlugin.manifest, id: 'terminal-plugin', name: 'Terminal', description: 'Integrated shell' } }
    const attentionPlugin = { ...mockPlugin, manifest: { ...mockPlugin.manifest, id: 'browser-plugin', name: 'Browser', description: 'Web previews' }, state: 'error' as const, error: 'Built-in registration missing: com.openforge.browser' }
    installedPlugins.set(new Map([
      ['test-plugin', mockPlugin],
      ['terminal-plugin', disabledPlugin],
      ['browser-plugin', attentionPlugin],
    ]))
    enabledPluginIds.set(new Set(['test-plugin', 'browser-plugin']))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    await fireEvent.input(screen.getByPlaceholderText('Search plugins'), { target: { value: 'terminal' } })
    expect(screen.getByText('Terminal')).toBeTruthy()
    expect(screen.queryByText('Test Plugin')).toBeNull()

    await fireEvent.input(screen.getByPlaceholderText('Search plugins'), { target: { value: '' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(screen.getByText('Browser')).toBeTruthy()
    expect(screen.getByText('Built-in registration missing: com.openforge.browser')).toBeTruthy()
    expect(screen.queryByText('Terminal')).toBeNull()
  })
})

describe('GlobalPluginSettingsPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()

    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    pluginLoadError.set(null)
  })

  it('renders empty global installation inventory', () => {
    render(GlobalPluginSettingsPanel)
    expect(screen.getByText('Plugins')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install package' })).toBeTruthy()
    expect(screen.getByText('No plugins installed')).toBeTruthy()
  })

  it('renders app-wide install metadata for installed plugins', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    expect(screen.getByText('Test Plugin')).toBeTruthy()
    expect(screen.getByText('A test plugin')).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.queryByText('Installed app-wide')).toBeNull()
    expect(screen.getByText('npm:@acme/test-plugin@1.0.0')).toBeTruthy()
    expect(screen.queryByText('test-plugin')).toBeNull()
    expect(screen.getByText('read:files')).toBeTruthy()
  })

  it('does not render a separate raw plugin id when the source already identifies the package', () => {
    installedPlugins.set(new Map([[
      'com.openforge.github-sync',
      {
        ...mockPlugin,
        manifest: { ...mockPlugin.manifest, id: 'com.openforge.github-sync', name: 'GitHub Sync' },
        sourceSpec: 'com.openforge.github-sync',
      },
    ]]))

    render(GlobalPluginSettingsPanel)

    expect(screen.getAllByText('com.openforge.github-sync')).toHaveLength(1)
  })

  it('uses native disabled semantics for install and global plugin action controls when disabled', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel, { activeProjectId: 'proj-1', disabled: true })

    expect((screen.getByLabelText('Source type') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('Package source') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Install package' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reload plugin: Test Plugin' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Copy diagnostics: Test Plugin' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not submit plugin installs while disabled', async () => {
    vi.mocked(installPluginFromNpm).mockResolvedValue(undefined)
    render(GlobalPluginSettingsPanel, { disabled: true })

    const submitButton = screen.getByRole('button', { name: 'Install package' })
    const form = submitButton.closest('form')
    expect(form).toBeTruthy()

    await fireEvent.submit(form as HTMLFormElement)

    expect(installPluginFromNpm).not.toHaveBeenCalled()
  })

  it('installs npm packages globally without silently enabling them', async () => {
    vi.mocked(installPluginFromNpm).mockImplementation(async () => {
      installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    })
    render(GlobalPluginSettingsPanel, { activeProjectId: 'proj-1' })

    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '@acme/openforge-github@1.2.0' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))

    expect(installPluginFromNpm).toHaveBeenCalledWith('@acme/openforge-github@1.2.0')
    expect(enablePluginForProject).not.toHaveBeenCalled()
    expect(screen.getByText('Installed app-wide. Enable it explicitly in each project when ready.')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Enable for active project: Test Plugin' }))
    expect(enablePluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
  })

  it('installs git and local package sources through the selected source flow', async () => {
    vi.mocked(installPluginFromGit).mockResolvedValue(undefined)
    vi.mocked(installFromLocal).mockResolvedValue(undefined)
    render(GlobalPluginSettingsPanel, { activeProjectId: 'proj-1' })

    await fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'git' } })
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: 'github.com/acme/openforge-tools@main' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installPluginFromGit).toHaveBeenCalledWith('github.com/acme/openforge-tools@main')

    await fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'local' } })
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '/Users/me/plugins/local-plugin' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installFromLocal).toHaveBeenCalledWith('/Users/me/plugins/local-plugin', 'proj-1')
  })

  it('shows install and load errors and can copy plugin diagnostics', async () => {
    vi.mocked(installPluginFromNpm).mockRejectedValue(new Error('npm install failed'))
    pluginLoadError.set('Failed to list plugins')
    installedPlugins.set(new Map([['test-plugin', { ...mockPlugin, state: 'error', error: 'activation failed' }]]))
    vi.mocked(writeClipboardText).mockResolvedValue(undefined)

    render(GlobalPluginSettingsPanel, { activeProjectId: 'proj-1' })

    expect(screen.getByText('Failed to list plugins')).toBeTruthy()
    expect(screen.getByText('activation failed')).toBeTruthy()

    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '@acme/broken-plugin' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(screen.getByText('npm install failed')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics: Test Plugin' }))
    expect(writeClipboardText).toHaveBeenCalledWith(expect.stringContaining('activation failed'))
  })

  it('reloads a plugin from global inventory using the active project context when present', async () => {
    vi.mocked(reloadPluginForProject).mockResolvedValue(true)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel, { activeProjectId: 'proj-1' })

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Test Plugin' }))
    expect(reloadPluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
    expect(reloadInstalledPluginMetadata).not.toHaveBeenCalled()
  })

  it('refreshes only global install metadata when reloading without an active project', async () => {
    vi.mocked(reloadInstalledPluginMetadata).mockResolvedValue(true)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Test Plugin' }))
    expect(reloadInstalledPluginMetadata).toHaveBeenCalledWith('test-plugin')
    expect(reloadPluginForProject).not.toHaveBeenCalled()
  })

  it('clears stale action errors before a successful metadata reload', async () => {
    vi.mocked(reloadInstalledPluginMetadata)
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockResolvedValueOnce(true)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    const reloadButton = screen.getByRole('button', { name: 'Reload plugin: Test Plugin' })
    await fireEvent.click(reloadButton)
    expect(screen.getByText('reload failed')).toBeTruthy()

    await fireEvent.click(reloadButton)
    expect(screen.queryByText('reload failed')).toBeNull()
  })

  it('uninstalls custom plugins through the global inventory', async () => {
    vi.mocked(uninstallPlugin).mockResolvedValue(undefined)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' }))
    expect(uninstallPlugin).toHaveBeenCalledWith('test-plugin')
  })

  it('surfaces uninstall errors through the existing action error message', async () => {
    vi.mocked(uninstallPlugin).mockRejectedValue(new Error('uninstall failed'))
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' }))
    expect(screen.getByText('uninstall failed')).toBeTruthy()
  })

  it('does not show uninstall for built-in plugins', () => {
    installedPlugins.set(new Map([
      ['builtin-flag', { ...mockPlugin, manifest: { ...mockPlugin.manifest, id: 'builtin-flag' }, isBuiltin: true }],
      ['builtin-source', { ...mockPlugin, manifest: { ...mockPlugin.manifest, id: 'builtin-source' }, sourceKind: 'builtin' }],
    ]))

    render(GlobalPluginSettingsPanel)

    expect(screen.queryByRole('button', { name: /Uninstall plugin/i })).toBeNull()
  })
})
