import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'
import PluginSettingsPanel from './PluginSettingsPanel.svelte'
import { appEnabledPluginIds, installedPlugins, enabledPluginIds, error as pluginLoadError } from '../../lib/plugin/pluginStore'
import {
  disablePluginForApp,
  disablePluginForProject,
  enablePluginForApp,
  enablePluginForProject,
  installFromLocal,
  installPluginFromGit,
  installPluginFromNpm,
  reloadInstalledPluginMetadata,
  reloadPluginForProject,
  uninstallPlugin,
} from '../../lib/plugin/pluginRegistry'
import { chooseSelectOption } from '../../test-utils/select'
import { writeClipboardText } from '../../lib/ipc'
import type { PluginEntry } from '../../lib/plugin/types'

vi.mock('../../lib/plugin/pluginStore', () => {
  const { writable } = require('svelte/store')
  return {
    installedPlugins: writable(new Map()),
    enabledPluginIds: writable(new Set()),
    appEnabledPluginIds: writable(new Set()),
    projectEnabledPluginIds: writable(new Set()),
    runtimeContributionSources: writable(new Map()),
    error: writable(null),
  }
})

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: vi.fn(),
  enablePluginForApp: vi.fn(),
  disablePluginForApp: vi.fn(),
  enablePluginForProject: vi.fn(),
  disablePluginForProject: vi.fn(),
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
    appEnabledPluginIds.set(new Set())
    pluginLoadError.set(null)
  })

  it('renders the project empty state when no project-enabled plugins are installed', () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    expect(screen.getByText('Project plugins')).toBeTruthy()
    expect(screen.getByText('Enable installed plugins for this project.')).toBeTruthy()
    expect(screen.getByText('No project-enabled plugins installed')).toBeTruthy()
  })

  it('clarifies that plugin enablement inherits global defaults and applies to this project only', () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    expect(screen.getByText(/inherit(s)? your global plugin defaults/i)).toBeTruthy()
    expect(screen.getByText(/apply to this project only/i)).toBeTruthy()
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
  it('does not list app-enabled packages in Project Settings', () => {
    const appPlugin: PluginEntry = {
      ...mockPlugin,
      packageMetadata: {
        id: 'test-plugin',
        apiVersion: 1,
        displayName: 'Test Plugin',
        description: 'App-wide plugin',
        enablement: 'app',
        frontend: './index.js',
        requires: ['appEnablement'],
      },
    }
    installedPlugins.set(new Map([['test-plugin', appPlugin]]))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    expect(screen.queryByText('Test Plugin')).toBeNull()
  })
})

describe('GlobalPluginSettingsPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()

    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    appEnabledPluginIds.set(new Set())
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

  it('enables and disables app-owned plugins once from Global Settings', async () => {
    const appPlugin: PluginEntry = {
      ...mockPlugin,
      packageMetadata: {
        id: 'test-plugin',
        apiVersion: 1,
        displayName: 'Test Plugin',
        description: 'App-wide plugin',
        enablement: 'app',
        frontend: './index.js',
        requires: ['appEnablement'],
      },
    }
    installedPlugins.set(new Map([['test-plugin', appPlugin]]))

    const first = render(GlobalPluginSettingsPanel)
    await fireEvent.click(screen.getByRole('switch', { name: 'Enabled throughout OpenForge: Test Plugin' }))
    expect(enablePluginForApp).toHaveBeenCalledWith('test-plugin')

    first.unmount()
    appEnabledPluginIds.set(new Set(['test-plugin']))
    render(GlobalPluginSettingsPanel)
    await fireEvent.click(screen.getByRole('switch', { name: 'Enabled throughout OpenForge: Test Plugin' }))
    expect(disablePluginForApp).toHaveBeenCalledWith('test-plugin')
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

    expect((screen.getByRole('button', { name: 'Source type' }) as HTMLButtonElement).disabled).toBe(true)
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

    await chooseSelectOption(screen.getByRole('button', { name: 'Source type' }), 'git')
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: 'github.com/acme/openforge-tools@main' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installPluginFromGit).toHaveBeenCalledWith('github.com/acme/openforge-tools@main')

    await chooseSelectOption(screen.getByRole('button', { name: 'Source type' }), 'local path')
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '/Users/me/plugins/local-plugin' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installFromLocal).toHaveBeenCalledWith('/Users/me/plugins/local-plugin', 'proj-1')
  })

  it('associates install errors with the package field and lets the user correct and retry', async () => {
    vi.mocked(installPluginFromNpm)
      .mockRejectedValueOnce(new Error('Package not found'))
      .mockResolvedValueOnce(undefined)
    render(GlobalPluginSettingsPanel)
    const source = screen.getByRole('textbox', { name: 'Package source' })
    await fireEvent.input(source, { target: { value: '@acme/missing' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))

    expect(source).toHaveAttribute('aria-invalid', 'true')
    expect(source).toHaveAccessibleDescription('Package not found')
    expect(screen.getByText('Package not found')).toHaveAttribute('role', 'alert')

    await fireEvent.input(source, { target: { value: '@acme/found' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(source).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Package not found')).toBeNull()
    expect(screen.getByText('Installed app-wide. Enable it explicitly in each project when ready.')).toBeTruthy()
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
    expect(uninstallPlugin).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm uninstall plugin: Test Plugin' }))
    expect(uninstallPlugin).toHaveBeenCalledWith('test-plugin')
  })

  it('does not uninstall when the confirmation is cancelled', async () => {
    vi.mocked(uninstallPlugin).mockResolvedValue(undefined)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(uninstallPlugin).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' })).toBeTruthy()
  })

  it('surfaces uninstall errors through the existing action error message', async () => {
    vi.mocked(uninstallPlugin).mockRejectedValue(new Error('uninstall failed'))
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel)

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Test Plugin' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm uninstall plugin: Test Plugin' }))
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

  it('renders an enable-by-default toggle per plugin reflecting the passed global default', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel, {
      pluginDefaults: new Map([['test-plugin', true]]),
      onToggleDefault: vi.fn(),
    })

    const toggle = screen.getByRole('switch', { name: 'Enable by default: Test Plugin' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.dataset.testid).toBe('plugin-default-test-plugin')
  })

  it('reflects a plugin without an explicit global default as unchecked', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel, {
      pluginDefaults: new Map(),
      onToggleDefault: vi.fn(),
    })

    expect((screen.getByRole('switch', { name: 'Enable by default: Test Plugin' }) as HTMLInputElement).checked).toBe(false)
  })

  it('invokes onToggleDefault with the plugin id and next enabled state', async () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    const onToggleDefault = vi.fn()

    render(GlobalPluginSettingsPanel, {
      pluginDefaults: new Map([['test-plugin', false]]),
      onToggleDefault,
    })

    await fireEvent.click(screen.getByRole('switch', { name: 'Enable by default: Test Plugin' }))
    expect(onToggleDefault).toHaveBeenCalledWith('test-plugin', true)
  })

  it('disables the enable-by-default toggle when the panel is disabled', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(GlobalPluginSettingsPanel, {
      disabled: true,
      pluginDefaults: new Map([['test-plugin', true]]),
      onToggleDefault: vi.fn(),
    })

    expect((screen.getByRole('switch', { name: 'Enable by default: Test Plugin' }) as HTMLInputElement).disabled).toBe(true)
  })
})
