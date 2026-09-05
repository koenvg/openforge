import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import {
  activatePlugin, appEnabledPluginIds, deactivatePluginById, defineFrontendPlugin,
  enabledPluginIds, get, getEnabledAppPluginsMock, getPluginIpcMock, installedPlugins,
  loadPluginFrontendMock, makeManifest, makeNormalized, resetPluginRegistryTestState,
  setConfigMock,
} from '../../lib/plugin/pluginRegistryTestSupport'
import { LIGHT_THEME } from '../../lib/themeContract'
import { selectedTheme, themeRegistry } from '../../lib/theme'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'

const pluginId = 'theme-recovery'
const themeId = `${pluginId}:paper`
const metadata: OpenForgePackageMetadata = {
  id: pluginId, displayName: 'Theme Recovery', description: 'Theme recovery fixture', apiVersion: 1,
  frontend: './frontend.js', enablement: 'app', requires: ['appEnablement', 'themes'],
}

function themePlugin() {
  return defineFrontendPlugin({
    activate(api, context) {
      context.subscriptions.add(api.themes.register({
        id: 'paper', label: 'Recovery Paper', appearance: 'light', tokens: LIGHT_THEME.tokens,
      }))
    },
  })
}

beforeEach(async () => {
  resetPluginRegistryTestState()
  await themeRegistry.selectTheme(LIGHT_THEME.id)
  installedPlugins.set(new Map([[pluginId, {
    manifest: makeManifest({ id: pluginId, name: 'Theme Recovery', frontend: './frontend.js' }),
    state: 'installed', error: null, packageMetadata: metadata,
  }]]))
  appEnabledPluginIds.set(new Set([pluginId]))
  enabledPluginIds.set(new Set([pluginId]))
  const normalized = {
    ...makeNormalized(pluginId), name: 'Theme Recovery', frontendEntry: './frontend.js',
    packageMetadata: JSON.stringify(metadata),
  }
  getPluginIpcMock.mockResolvedValue(normalized)
  getEnabledAppPluginsMock.mockResolvedValue([normalized])
})

afterEach(async () => {
  cleanup()
  await deactivatePluginById(pluginId)
  await themeRegistry.selectTheme(LIGHT_THEME.id)
})

describe('host plugin controls with a selected theme', () => {
  it('recovers from a failed reload and lets the user reload and disable the theme owner', async () => {
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId, module: themePlugin() })
      .mockResolvedValueOnce({
        pluginId, module: defineFrontendPlugin({ activate() { throw new Error('Theme activation failed') } }),
      })
      .mockResolvedValueOnce({ pluginId, module: themePlugin() })
    expect(await activatePlugin(pluginId)).toBe(true)
    await themeRegistry.selectTheme(themeId)
    render(GlobalPluginSettingsPanel, { activeProjectId: 'P-1' })
    expect(screen.getByText('Provided by theme-recovery')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Theme Recovery' }))
    await waitFor(() => {
      expect(screen.getByText('Theme activation failed')).toBeTruthy()
      expect(get(selectedTheme).id).toBe(LIGHT_THEME.id)
      expect(screen.queryByText('Recovery Paper')).toBeNull()
    })
    expect(setConfigMock).toHaveBeenCalledWith('theme', LIGHT_THEME.id)
    expect(screen.getByText(/not sandboxed/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Copy diagnostics: Theme Recovery' }) as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Theme Recovery' }))
    await waitFor(() => expect(screen.getByText('Recovery Paper')).toBeTruthy())
    expect(screen.queryByText('Theme activation failed')).toBeNull()
    await themeRegistry.selectTheme(themeId)
    expect(get(selectedTheme).id).toBe(themeId)

    await fireEvent.click(screen.getByRole('switch', { name: 'Enabled throughout OpenForge: Theme Recovery' }))
    await waitFor(() => {
      expect(get(selectedTheme).id).toBe(LIGHT_THEME.id)
      expect(screen.queryByText('Recovery Paper')).toBeNull()
      expect((screen.getByRole('switch', { name: 'Enabled throughout OpenForge: Theme Recovery' }) as HTMLInputElement).checked).toBe(false)
    })
    expect(setConfigMock).toHaveBeenLastCalledWith('theme', LIGHT_THEME.id)
    expect(screen.getByRole('button', { name: 'Install package' })).toBeTruthy()
  })
})
