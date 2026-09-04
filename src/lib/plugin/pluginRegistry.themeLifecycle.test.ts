import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenForgePackageMetadata, PluginThemeDefinition } from '@openforge-app/plugin-sdk'
import {
  LIGHT_THEME,
  BUILTIN_LIGHT_THEME_ID,
} from '../themeContract'
import {
  activatePlugin,
  appEnabledPluginIds,
  defineFrontendPlugin,
  disablePluginForApp,
  deactivatePluginById,
  enabledPluginIds,
  get,
  getEnabledAppPluginsMock,
  getPluginIpcMock,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  makeNormalized,
  reloadPluginForApp,
  resetPluginRegistryTestState,
  uninstallPlugin,
  uninstallPluginIpcMock,
} from './pluginRegistryTestSupport'
const { availableThemes, selectedTheme, themeRegistry } = await import('../theme')

const pluginId = 'theme-pack'
const qualifiedThemeId = `${pluginId}:paper`
const packageMetadata: OpenForgePackageMetadata = {
  id: pluginId,
  apiVersion: 1,
  displayName: 'Theme Pack',
  description: 'Contributes application themes',
  enablement: 'app',
  frontend: './frontend.js',
  requires: ['appEnablement', 'themes'],
}

function theme(label: string, accent: string): PluginThemeDefinition {
  return {
    id: 'paper',
    label,
    appearance: 'light',
    tokens: { ...LIGHT_THEME.tokens, accent },
  }
}

function pluginWithTheme(definition: PluginThemeDefinition) {
  return defineFrontendPlugin({
    activate(openforge, context) {
      context.subscriptions.add(openforge.themes.register(definition))
    },
  })
}

function normalizedPlugin() {
  return {
    ...makeNormalized(pluginId),
    frontendEntry: './frontend.js',
    packageMetadata: JSON.stringify(packageMetadata),
  }
}

function installEnabledPlugin(): void {
  installedPlugins.set(new Map([[pluginId, {
    manifest: makeManifest({ id: pluginId, frontend: './frontend.js' }),
    state: 'installed',
    error: null,
    packageMetadata,
  }]]))
  appEnabledPluginIds.set(new Set([pluginId]))
  enabledPluginIds.set(new Set([pluginId]))
}

describe('plugin theme contribution lifecycle', () => {
  beforeEach(async () => {
    resetPluginRegistryTestState()
    await themeRegistry.selectTheme(BUILTIN_LIGHT_THEME_ID)
  })

  afterEach(async () => {
    await deactivatePluginById(pluginId)
  })

  it('qualifies registrations, records plugin ownership, and removes the activation generation', async () => {
    installEnabledPlugin()
    loadPluginFrontendMock.mockResolvedValue({
      pluginId,
      module: pluginWithTheme(theme('Paper', '#3366ff')),
    })

    await expect(activatePlugin(pluginId)).resolves.toBe(true)

    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)).toMatchObject({
      id: qualifiedThemeId,
      label: 'Paper',
    })
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)?.owner).toEqual({ kind: 'plugin', pluginId, generation: 0 })

    await disablePluginForApp(pluginId)

    expect(get(availableThemes).some(candidate => candidate.id === qualifiedThemeId)).toBe(false)
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)?.owner).toBeUndefined()
  })

  it('falls back and removes the selected theme when its app plugin is disabled', async () => {
    installEnabledPlugin()
    loadPluginFrontendMock.mockResolvedValue({ pluginId, module: pluginWithTheme(theme('Paper', '#3366ff')) })
    await activatePlugin(pluginId)
    await themeRegistry.selectTheme(qualifiedThemeId)

    await disablePluginForApp(pluginId)

    expect(get(selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(get(availableThemes).some(candidate => candidate.id === qualifiedThemeId)).toBe(false)
  })

  it('falls back and removes the selected theme when its plugin is uninstalled', async () => {
    installEnabledPlugin()
    loadPluginFrontendMock.mockResolvedValue({ pluginId, module: pluginWithTheme(theme('Paper', '#3366ff')) })
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    await activatePlugin(pluginId)
    await themeRegistry.selectTheme(qualifiedThemeId)

    await uninstallPlugin(pluginId)

    expect(get(selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(get(availableThemes).some(candidate => candidate.id === qualifiedThemeId)).toBe(false)
  })

  it('atomically replaces registrations on successful reload with the new generation', async () => {
    installEnabledPlugin()
    getPluginIpcMock.mockResolvedValue(normalizedPlugin())
    getEnabledAppPluginsMock.mockResolvedValue([normalizedPlugin()])
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId, module: pluginWithTheme(theme('Paper v1', '#3366ff')) })
      .mockResolvedValueOnce({ pluginId, module: pluginWithTheme(theme('Paper v2', '#2255dd')) })

    await activatePlugin(pluginId)
    await themeRegistry.selectTheme(qualifiedThemeId)
    await expect(reloadPluginForApp(pluginId)).resolves.toBe(true)

    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)).toMatchObject({
      label: 'Paper v2',
      tokens: { accent: '#2255dd' },
    })
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)?.owner).toEqual({ kind: 'plugin', pluginId, generation: 1 })
  })

  it('ignores a stale activation completion after a newer reload generation wins', async () => {
    installEnabledPlugin()
    let releaseStale: (() => void) | undefined
    const staleGate = new Promise<void>(resolve => { releaseStale = resolve })
    const stalePlugin = defineFrontendPlugin({
      async activate(openforge, context) {
        await staleGate
        context.subscriptions.add(openforge.themes.register(theme('Stale Paper', '#ff0000')))
      },
    })
    getPluginIpcMock.mockResolvedValue(normalizedPlugin())
    getEnabledAppPluginsMock.mockResolvedValue([normalizedPlugin()])
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId, module: stalePlugin })
      .mockResolvedValueOnce({ pluginId, module: pluginWithTheme(theme('Fresh Paper', '#2255dd')) })

    const staleActivation = activatePlugin(pluginId)
    await vi.waitFor(() => expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1))
    const reload = reloadPluginForApp(pluginId)
    releaseStale?.()

    await expect(staleActivation).resolves.toBe(false)
    await expect(reload).resolves.toBe(true)
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)).toMatchObject({
      label: 'Fresh Paper',
    })
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)?.owner).toEqual({ kind: 'plugin', pluginId, generation: 1 })
  })

  it('falls back without leaked registrations when reload activation fails', async () => {
    installEnabledPlugin()
    getPluginIpcMock.mockResolvedValue(normalizedPlugin())
    getEnabledAppPluginsMock.mockResolvedValue([normalizedPlugin()])
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId, module: pluginWithTheme(theme('Paper', '#3366ff')) })
      .mockResolvedValueOnce({
        pluginId,
        module: defineFrontendPlugin({ activate() { throw new Error('reload failed') } }),
      })

    await activatePlugin(pluginId)
    await themeRegistry.selectTheme(qualifiedThemeId)
    await expect(reloadPluginForApp(pluginId)).resolves.toBe(false)

    expect(get(selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(get(availableThemes).some(candidate => candidate.id === qualifiedThemeId)).toBe(false)
    expect(get(availableThemes).find(candidate => candidate.id === qualifiedThemeId)?.owner).toBeUndefined()
  })
})
