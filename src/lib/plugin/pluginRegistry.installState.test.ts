import { beforeEach, describe, expect, it } from 'vitest'
import {
  enabledPluginIds,
  get,
  installFromLocal,
  installPluginFromGit,
  installPluginFromGitIpcMock,
  installPluginFromLocalIpcMock,
  installPluginFromManifest,
  installPluginFromNpm,
  installPluginFromNpmIpcMock,
  installPluginMock,
  installedPlugins,
  makeManifest,
  makeNormalized,
  resetPluginRegistryTestState,
} from './pluginRegistryTestSupport'

describe('pluginRegistry install state', () => {
  beforeEach(resetPluginRegistryTestState)

  it('installPluginFromManifest rejects legacy manifest installs loudly', async () => {
    const manifest = makeManifest()

    await expect(installPluginFromManifest(manifest, '/plugins/test-plugin')).rejects.toThrow(
      'Legacy manifest.json plugin installation is no longer supported'
    )
    expect(installPluginMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).has('test-plugin')).toBe(false)
  })

  it('installPluginFromNpm installs app-wide through IPC without enabling the project', async () => {
    installPluginFromNpmIpcMock.mockResolvedValue({
      ...makeNormalized('npm-plugin'),
      sourceKind: 'npm',
      sourceSpec: 'npm:@acme/plugin@1.0.0',
    })

    await installPluginFromNpm('@acme/plugin@1.0.0')

    expect(installPluginFromNpmIpcMock).toHaveBeenCalledWith('@acme/plugin@1.0.0')
    const entry = get(installedPlugins).get('npm-plugin')
    expect(entry?.installPath).toBe('/tmp/plugin')
    expect(entry?.sourceKind).toBe('npm')
    expect(entry?.sourceSpec).toBe('npm:@acme/plugin@1.0.0')
    expect(get(enabledPluginIds).has('npm-plugin')).toBe(false)
  })

  it('installPluginFromGit installs app-wide through IPC without enabling the project', async () => {
    installPluginFromGitIpcMock.mockResolvedValue({
      ...makeNormalized('git-plugin'),
      sourceKind: 'git',
      sourceSpec: 'git:github.com/acme/openforge-tools@main',
    })

    await installPluginFromGit('github.com/acme/openforge-tools@main')

    expect(installPluginFromGitIpcMock).toHaveBeenCalledWith('github.com/acme/openforge-tools@main')
    expect(get(installedPlugins).get('git-plugin')).toMatchObject({
      sourceKind: 'git',
      sourceSpec: 'git:github.com/acme/openforge-tools@main',
      state: 'installed',
    })
    expect(get(enabledPluginIds).has('git-plugin')).toBe(false)
  })

  it('installPluginFromManifest rejects every legacy manifest before validation compatibility paths run', async () => {
    const highVersion = makeManifest({ apiVersion: 99 })
    await expect(installPluginFromManifest(highVersion, '/tmp')).rejects.toThrow('Legacy manifest.json plugin installation is no longer supported')
    expect(installPluginMock).not.toHaveBeenCalled()
  })

  it('installFromLocal reads package metadata via IPC and does not enable the project', async () => {
    installPluginFromLocalIpcMock.mockResolvedValue({
      ...makeNormalized('local-plugin'),
      sourceKind: 'local',
      sourceSpec: '/plugins/test',
    })

    await installFromLocal('/plugins/test', 'project-1')

    expect(installPluginFromLocalIpcMock).toHaveBeenCalledWith('/plugins/test')
    expect(get(installedPlugins).get('local-plugin')).toMatchObject({
      sourceKind: 'local',
      sourceSpec: '/plugins/test',
      state: 'installed',
    })
    expect(get(enabledPluginIds).has('local-plugin')).toBe(false)
  })
})
