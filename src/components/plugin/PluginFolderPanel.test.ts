import { render, screen, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredPlugin } from '../../lib/ipc'
import type { PluginEntry } from '../../lib/plugin/types'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  selectDirectory: vi.fn(),
  scanPluginFolder: vi.fn(),
  writeClipboardText: vi.fn(),
  installFromLocal: vi.fn(),
  reloadLocalPluginFromDisk: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  selectDirectory: mocks.selectDirectory,
  scanPluginFolder: mocks.scanPluginFolder,
  writeClipboardText: mocks.writeClipboardText,
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  installFromLocal: mocks.installFromLocal,
  reloadLocalPluginFromDisk: mocks.reloadLocalPluginFromDisk,
}))

import { installedPlugins } from '../../lib/plugin/pluginStore'
import PluginFolderPanel from './PluginFolderPanel.svelte'

const FOLDER = '/Users/me/repos/openforge-plugins'
const PROJECT = 'project-1'

function discovered(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    path: `${FOLDER}/plugins/alpha`,
    id: 'com.acme.alpha',
    name: 'Alpha',
    version: '1.0.0',
    description: 'Alpha does things',
    installable: true,
    needsBuild: false,
    problem: null,
    ...overrides,
  }
}

function installedEntry(overrides: {
  id?: string
  version?: string
  installPath?: string
} = {}): PluginEntry {
  const id = overrides.id ?? 'com.acme.alpha'
  return {
    manifest: {
      id,
      name: 'Alpha',
      version: overrides.version ?? '1.0.0',
      apiVersion: 1,
      description: 'Alpha does things',
      permissions: [],
      frontend: 'dist/frontend.js',
      backend: null,
    },
    state: 'installed',
    error: null,
    installPath: overrides.installPath ?? `${FOLDER}/plugins/alpha`,
    sourceKind: 'local',
  }
}

function markInstalled(...entries: PluginEntry[]) {
  installedPlugins.set(new Map(entries.map((entry) => [entry.manifest.id, entry])))
}

async function renderWithFolder(rows: DiscoveredPlugin[], activeProjectId: string | null = PROJECT) {
  mocks.getConfig.mockResolvedValue(FOLDER)
  mocks.scanPluginFolder.mockResolvedValue(rows)
  render(PluginFolderPanel, { props: { activeProjectId } })
  await vi.waitFor(() => expect(mocks.scanPluginFolder).toHaveBeenCalledWith(FOLDER))
}

function clickRefresh() {
  return fireEvent.click(screen.getByRole('button', { name: 'Refresh plugin folder' }))
}

describe('PluginFolderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installedPlugins.set(new Map())
    mocks.getConfig.mockResolvedValue(null)
    mocks.setConfig.mockResolvedValue(undefined)
    mocks.scanPluginFolder.mockResolvedValue([])
    mocks.installFromLocal.mockResolvedValue(undefined)
    mocks.reloadLocalPluginFromDisk.mockResolvedValue(undefined)
  })

  it('offers to choose a folder when none is remembered yet', async () => {
    render(PluginFolderPanel)

    await vi.waitFor(() => expect(mocks.getConfig).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Choose plugin folder' })).toBeTruthy()
    expect(mocks.scanPluginFolder).not.toHaveBeenCalled()
  })

  it('shows a configuration read failure with a retry action', async () => {
    mocks.getConfig.mockRejectedValue(new Error('settings unavailable'))
    render(PluginFolderPanel)

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry loading plugin folder' })).toBeTruthy()
    expect(mocks.scanPluginFolder).not.toHaveBeenCalled()
  })

  it('recovers when retrying the configuration read', async () => {
    mocks.getConfig
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce(FOLDER)
    mocks.scanPluginFolder.mockResolvedValue([discovered()])
    render(PluginFolderPanel)

    await fireEvent.click(await screen.findByRole('button', { name: 'Retry loading plugin folder' }))

    await vi.waitFor(() => {
      expect(mocks.getConfig).toHaveBeenCalledTimes(2)
      expect(mocks.scanPluginFolder).toHaveBeenCalledWith(FOLDER)
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
    expect(screen.queryByText('settings unavailable')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry loading plugin folder' })).toBeNull()
  })

  it('starts only one configuration retry when the retry action is clicked twice', async () => {
    let resolveRetry: (folder: string) => void = () => {}
    const retryResult = new Promise<string>((resolve) => {
      resolveRetry = resolve
    })
    mocks.getConfig
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockReturnValue(retryResult)
    mocks.scanPluginFolder.mockResolvedValue([discovered()])
    render(PluginFolderPanel)

    const retry = await screen.findByRole('button', { name: 'Retry loading plugin folder' })
    retry.click()
    retry.click()

    expect(mocks.getConfig).toHaveBeenCalledTimes(2)
    resolveRetry(FOLDER)
    await vi.waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
  })

  it('remembers the chosen folder and scans it', async () => {
    mocks.selectDirectory.mockResolvedValue(FOLDER)
    mocks.scanPluginFolder.mockResolvedValue([discovered()])
    render(PluginFolderPanel)
    await vi.waitFor(() => expect(mocks.getConfig).toHaveBeenCalled())

    await fireEvent.click(screen.getByRole('button', { name: 'Choose plugin folder' }))

    await vi.waitFor(() => {
      expect(mocks.setConfig).toHaveBeenCalledWith('plugin_folder_path', FOLDER)
      expect(mocks.scanPluginFolder).toHaveBeenCalledWith(FOLDER)
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
  })

  it('keeps the previous folder when the picker is cancelled', async () => {
    mocks.selectDirectory.mockResolvedValue(null)
    render(PluginFolderPanel)
    await vi.waitFor(() => expect(mocks.getConfig).toHaveBeenCalled())

    await fireEvent.click(screen.getByRole('button', { name: 'Choose plugin folder' }))

    await vi.waitFor(() => expect(mocks.selectDirectory).toHaveBeenCalled())
    expect(mocks.setConfig).not.toHaveBeenCalled()
    expect(mocks.scanPluginFolder).not.toHaveBeenCalled()
  })

  it('scans the remembered folder on mount and lists what it finds', async () => {
    await renderWithFolder([
      discovered(),
      discovered({
        path: `${FOLDER}/plugins/beta`,
        id: 'com.acme.beta',
        name: 'Beta',
        version: '2.0.0',
        description: 'Beta does other things',
      }),
    ])

    expect(screen.getByText(FOLDER)).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Alpha does things')).toBeTruthy()
  })

  it('installs a discovered plugin from its own folder path', async () => {
    await renderWithFolder([discovered()])

    await fireEvent.click(screen.getByRole('button', { name: 'Install plugin: Alpha' }))

    await vi.waitFor(() =>
      expect(mocks.installFromLocal).toHaveBeenCalledWith(`${FOLDER}/plugins/alpha`, ''),
    )
  })

  it('rescans after an install so the row reflects what is now installed', async () => {
    await renderWithFolder([discovered()])

    await fireEvent.click(screen.getByRole('button', { name: 'Install plugin: Alpha' }))

    await vi.waitFor(() => expect(mocks.scanPluginFolder).toHaveBeenCalledTimes(2))
  })

  it('surfaces an install failure without clearing the list', async () => {
    mocks.installFromLocal.mockRejectedValue(new Error('install exploded'))
    await renderWithFolder([discovered()])

    await fireEvent.click(screen.getByRole('button', { name: 'Install plugin: Alpha' }))

    await vi.waitFor(() => expect(screen.getByText('install exploded')).toBeTruthy())
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('does not offer to install a plugin that has not been built', async () => {
    await renderWithFolder([
      discovered({
        installable: false,
        needsBuild: true,
        problem: 'OpenForge plugin frontend entry is missing; run the package build first',
      }),
    ])

    expect(screen.queryByRole('button', { name: 'Install plugin: Alpha' })).toBeNull()
    expect(screen.getByText('Needs build')).toBeTruthy()
    expect(
      screen.getByText('OpenForge plugin frontend entry is missing; run the package build first'),
    ).toBeTruthy()
  })

  it.each([
    ['ordinary path', `${FOLDER}/plugins/alpha`, `'${FOLDER}/plugins/alpha'`],
    ['spaces', '/Users/me/My Plugins/alpha', "'/Users/me/My Plugins/alpha'"],
    ['apostrophes', "/Users/me/it's/alpha's", "'/Users/me/it'\"'\"'s/alpha'\"'\"'s'"],
    ['shell metacharacters', '/plugins/$HOME;$(echo injected)`echo injected`&|<>*?[]"\\alpha', "'/plugins/$HOME;$(echo injected)`echo injected`&|<>*?[]\"\\alpha'"],
  ])('copies a safely quoted build command for %s', async (_label, path, quotedPath) => {
    await renderWithFolder([
      discovered({ path, installable: false, needsBuild: true, problem: 'entry missing' }),
    ])

    await fireEvent.click(screen.getByRole('button', { name: 'Copy build command: Alpha' }))

    await vi.waitFor(() =>
      expect(mocks.writeClipboardText).toHaveBeenCalledWith(
        `pnpm -C ${quotedPath} build`,
      ),
    )
  })

  it('shows a validation problem without offering an install', async () => {
    await renderWithFolder([
      discovered({
        installable: false,
        needsBuild: false,
        problem: 'package.json openforge.apiVersion 99 is not supported (supported: 1)',
      }),
    ])

    expect(screen.queryByRole('button', { name: 'Install plugin: Alpha' })).toBeNull()
    expect(screen.queryByText('Needs build')).toBeNull()
    expect(
      screen.getByText('package.json openforge.apiVersion 99 is not supported (supported: 1)'),
    ).toBeTruthy()
  })

  it('marks an already installed plugin instead of offering it again', async () => {
    markInstalled(installedEntry())
    await renderWithFolder([discovered()])

    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install plugin: Alpha' })).toBeNull()
  })

  it('offers a reload when the folder has a newer version than the installed one', async () => {
    markInstalled(installedEntry({ version: '1.0.0' }))
    await renderWithFolder([discovered({ version: '1.1.0' })])

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Alpha' }))

    await vi.waitFor(() =>
      expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith(
        'com.acme.alpha',
        `${FOLDER}/plugins/alpha`,
        PROJECT,
      ),
    )
  })

  // A rebuild does not have to bump the version, so an up-to-date row still needs the affordance.
  it('offers a reload for a plugin whose version has not moved', async () => {
    markInstalled(installedEntry({ version: '1.0.0' }))
    await renderWithFolder([discovered({ version: '1.0.0' })])

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Alpha' }))

    await vi.waitFor(() =>
      expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith(
        'com.acme.alpha',
        `${FOLDER}/plugins/alpha`,
        PROJECT,
      ),
    )
  })

  it('reports a reload that did not take', async () => {
    mocks.reloadLocalPluginFromDisk.mockRejectedValue(new Error('frontend entry is missing'))
    markInstalled(installedEntry({ version: '1.0.0' }))
    await renderWithFolder([discovered({ version: '1.1.0' })])

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Alpha' }))

    await vi.waitFor(() =>
      expect(screen.getByText('Could not reload Alpha: frontend entry is missing')).toBeTruthy(),
    )
  })

  it('reloads every plugin installed from this folder on refresh', async () => {
    markInstalled(
      installedEntry({ version: '1.0.0' }),
      installedEntry({ id: 'com.acme.beta', version: '1.0.0', installPath: `${FOLDER}/plugins/beta` }),
    )
    await renderWithFolder([
      discovered({ version: '1.0.0' }),
      discovered({ path: `${FOLDER}/plugins/beta`, id: 'com.acme.beta', name: 'Beta', version: '2.0.0' }),
      discovered({ path: `${FOLDER}/plugins/gamma`, id: 'com.acme.gamma', name: 'Gamma' }),
    ])

    await clickRefresh()

    await vi.waitFor(() => expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledTimes(2))
    expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith('com.acme.alpha', `${FOLDER}/plugins/alpha`, PROJECT)
    expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith('com.acme.beta', `${FOLDER}/plugins/beta`, PROJECT)
  })

  it('leaves packages installed from somewhere else untouched on refresh', async () => {
    markInstalled(installedEntry({ installPath: '/somewhere/else/alpha' }))
    await renderWithFolder([discovered()])

    await clickRefresh()

    await vi.waitFor(() => expect(mocks.scanPluginFolder).toHaveBeenCalledTimes(2))
    expect(mocks.reloadLocalPluginFromDisk).not.toHaveBeenCalled()
  })

  it('reloads plugins on refresh even with no active project', async () => {
    markInstalled(installedEntry())
    await renderWithFolder([discovered()], null)

    await clickRefresh()

    await vi.waitFor(() =>
      expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith(
        'com.acme.alpha',
        `${FOLDER}/plugins/alpha`,
        null,
      ),
    )
  })

  it('reports the plugins that failed to reload and still reloads the rest', async () => {
    mocks.reloadLocalPluginFromDisk.mockImplementation(async (pluginId: string) => {
      if (pluginId === 'com.acme.alpha') throw new Error('frontend entry is missing')
    })
    markInstalled(
      installedEntry(),
      installedEntry({ id: 'com.acme.beta', installPath: `${FOLDER}/plugins/beta` }),
    )
    await renderWithFolder([
      discovered(),
      discovered({ path: `${FOLDER}/plugins/beta`, id: 'com.acme.beta', name: 'Beta' }),
    ])

    await clickRefresh()

    await vi.waitFor(() =>
      expect(screen.getByText('Could not reload Alpha: frontend entry is missing')).toBeTruthy(),
    )
    expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith('com.acme.beta', `${FOLDER}/plugins/beta`, PROJECT)
  })

  it('does not reload anything when the folder can no longer be scanned', async () => {
    markInstalled(installedEntry())
    await renderWithFolder([discovered()])
    mocks.scanPluginFolder.mockRejectedValue(new Error('plugin folder is not a directory: /gone'))

    await clickRefresh()

    await vi.waitFor(() =>
      expect(screen.getByText('plugin folder is not a directory: /gone')).toBeTruthy(),
    )
    expect(mocks.reloadLocalPluginFromDisk).not.toHaveBeenCalled()
  })

  it('does not auto-reload a plugin installed from a different folder', async () => {
    markInstalled(installedEntry({ installPath: '/somewhere/else/alpha' }))
    await renderWithFolder([discovered()])

    expect(screen.queryByRole('button', { name: 'Install plugin: Alpha' })).toBeNull()
    expect(screen.getByText('Installed from another folder')).toBeTruthy()

    await clickRefresh()

    await vi.waitFor(() => expect(mocks.scanPluginFolder).toHaveBeenCalledTimes(2))
    expect(mocks.reloadLocalPluginFromDisk).not.toHaveBeenCalled()
  })

  it('lets you repoint a plugin installed from a different folder onto this one', async () => {
    markInstalled(installedEntry({ installPath: '/somewhere/else/alpha' }))
    await renderWithFolder([discovered()])

    await fireEvent.click(screen.getByRole('button', { name: 'Load plugin from this folder: Alpha' }))

    await vi.waitFor(() =>
      expect(mocks.reloadLocalPluginFromDisk).toHaveBeenCalledWith(
        'com.acme.alpha',
        `${FOLDER}/plugins/alpha`,
        PROJECT,
      ),
    )
  })

  it('installs every installable plugin that is not installed yet', async () => {
    markInstalled(installedEntry({ id: 'com.acme.beta', installPath: `${FOLDER}/plugins/beta` }))
    await renderWithFolder([
      discovered(),
      discovered({ path: `${FOLDER}/plugins/beta`, id: 'com.acme.beta', name: 'Beta' }),
      discovered({ path: `${FOLDER}/plugins/gamma`, id: 'com.acme.gamma', name: 'Gamma' }),
      discovered({
        path: `${FOLDER}/plugins/delta`,
        id: 'com.acme.delta',
        name: 'Delta',
        installable: false,
        needsBuild: true,
        problem: 'entry missing',
      }),
    ])

    await fireEvent.click(screen.getByRole('button', { name: 'Install all available (2)' }))

    await vi.waitFor(() => expect(mocks.installFromLocal).toHaveBeenCalledTimes(2))
    expect(mocks.installFromLocal).toHaveBeenCalledWith(`${FOLDER}/plugins/alpha`, '')
    expect(mocks.installFromLocal).toHaveBeenCalledWith(`${FOLDER}/plugins/gamma`, '')
  })

  it('hides the bulk install action when nothing is installable', async () => {
    markInstalled(installedEntry())
    await renderWithFolder([discovered()])

    expect(screen.queryByRole('button', { name: /^Install all available/ })).toBeNull()
  })

  it('rescans the folder on refresh', async () => {
    await renderWithFolder([discovered()])
    mocks.scanPluginFolder.mockResolvedValue([
      discovered(),
      discovered({ path: `${FOLDER}/plugins/beta`, id: 'com.acme.beta', name: 'Beta' }),
    ])

    await clickRefresh()

    await vi.waitFor(() => expect(screen.getByText('Beta')).toBeTruthy())
  })

  it('forgets the folder on remove', async () => {
    await renderWithFolder([discovered()])

    await fireEvent.click(screen.getByRole('button', { name: 'Remove plugin folder' }))

    await vi.waitFor(() => {
      expect(mocks.setConfig).toHaveBeenCalledWith('plugin_folder_path', '')
      expect(screen.getByRole('button', { name: 'Choose plugin folder' })).toBeTruthy()
    })
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('reports a folder that can no longer be scanned', async () => {
    mocks.getConfig.mockResolvedValue(FOLDER)
    mocks.scanPluginFolder.mockRejectedValue(new Error('plugin folder is not a directory: /gone'))
    render(PluginFolderPanel)

    await vi.waitFor(() =>
      expect(screen.getByText('plugin folder is not a directory: /gone')).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: 'Refresh plugin folder' })).toBeTruthy()
  })

  it('reports an empty folder rather than looking broken', async () => {
    await renderWithFolder([])

    expect(screen.getByText('No plugin packages found in this folder')).toBeTruthy()
  })

  it('blocks every action while disabled', async () => {
    mocks.getConfig.mockResolvedValue(FOLDER)
    mocks.scanPluginFolder.mockResolvedValue([discovered()])
    render(PluginFolderPanel, { props: { disabled: true } })
    await vi.waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: 'Install plugin: Alpha' }))

    expect(mocks.installFromLocal).not.toHaveBeenCalled()
  })
})
