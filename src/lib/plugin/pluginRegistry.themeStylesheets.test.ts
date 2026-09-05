import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import {
  activatePlugin, appEnabledPluginIds, clearLoadedPluginMock, deactivatePluginById,
  deactivatePluginLoaderMock, disablePluginForApp, enabledPluginIds, get,
  getConfigMock, getEnabledAppPluginsMock, getPluginIpcMock, installedPlugins,
  loadPluginFrontendMock, makeManifest, makeNormalized, reloadPluginForApp,
  resetPluginRegistryTestState, setConfigMock, uninstallPlugin,
} from './pluginRegistryTestSupport'
import fixture from './fixtures/selected-theme/frontend.js'
import fixturePackage from './fixtures/selected-theme/package.json'
import { createSettingsThemeController } from '../../components/settings/settingsThemeController.svelte'
import { createThemeRuntime, selectedTheme, themeRegistry } from '../theme'
import { LIGHT_THEME } from '../themeContract'

const loader = await vi.importActual<typeof import('./pluginLoader')>('./pluginLoader')
const metadata = fixturePackage.openforge as OpenForgePackageMetadata
const pluginId = metadata.id
const themeId = `${pluginId}:paper`
let savedTheme: string | null

function themeLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll('link[data-openforge-theme-stylesheet]'))
}

async function finishStylesheets(generation: number) {
  await vi.waitFor(() => {
    expect(themeLinks()).toHaveLength(2)
    expect(themeLinks().every(link => link.href.endsWith(`?openforgeReload=${generation}`))).toBe(true)
  })
  for (const link of themeLinks()) {
    expect(link.href).toContain(`?openforgeReload=${generation}`)
    expect(link.media).toBe('not all')
    link.dispatchEvent(new Event('load'))
  }
}

beforeEach(async () => {
  resetPluginRegistryTestState()
  loader._resetPluginLoaderForTests()
  savedTheme = null
  getConfigMock.mockImplementation(async () => savedTheme)
  setConfigMock.mockImplementation(async (key, value) => { if (key === 'theme') savedTheme = value })
  await themeRegistry.selectTheme(LIGHT_THEME.id)
  loader._setModuleLoader(async () => fixture)
  loadPluginFrontendMock.mockImplementation(loader.loadPluginFrontend)
  deactivatePluginLoaderMock.mockImplementation(loader.deactivatePlugin)
  clearLoadedPluginMock.mockImplementation(loader.clearLoadedPlugin)
  installedPlugins.set(new Map([[pluginId, {
    manifest: makeManifest({ id: pluginId, frontend: './frontend.js' }),
    state: 'installed', error: null, packageMetadata: metadata,
  }]]))
  appEnabledPluginIds.set(new Set([pluginId]))
  enabledPluginIds.set(new Set([pluginId]))
  const normalized = {
    ...makeNormalized(pluginId), frontendEntry: './frontend.js',
    packageMetadata: JSON.stringify(metadata),
  }
  getPluginIpcMock.mockResolvedValue(normalized)
  getEnabledAppPluginsMock.mockResolvedValue([normalized])
})

afterEach(async () => {
  await deactivatePluginById(pluginId)
  loader._resetPluginLoaderForTests()
  await themeRegistry.selectTheme(LIGHT_THEME.id)
})

describe('selected-theme plugin fixture', () => {
  it('appears in settings, persists selection, reloads selected CSS, and falls back on disable', async () => {
    await expect(activatePlugin(pluginId)).resolves.toBe(true)
    const settings = createSettingsThemeController()
    expect(settings.availableThemes.find(theme => theme.id === themeId)).toMatchObject({
      label: 'Fixture Paper', owner: { kind: 'plugin', pluginId },
    })
    const viewCSS = document.querySelector<HTMLLinkElement>('link[data-openforge-plugin-stylesheet]')!
    expect(viewCSS.href).toBe('plugin://selected-theme-fixture/view.css')
    expect(themeLinks()).toEqual([])

    const selecting = settings.select(themeId)
    await finishStylesheets(0)
    await selecting
    expect(settings.selectedThemeId).toBe(themeId)
    expect(savedTheme).toBe(themeId)
    expect(document.documentElement.style.getPropertyValue('--of-canvas')).toBe('#FAF7F0')
    const previous = themeLinks()
    const reloading = reloadPluginForApp(pluginId)
    await finishStylesheets(1)
    await expect(reloading).resolves.toBe(true)
    expect(get(selectedTheme).id).toBe(themeId)
    expect(savedTheme).toBe(themeId)
    expect(previous.every(link => !link.isConnected)).toBe(true)
    expect(themeLinks().every(link => link.media === 'all')).toBe(true)

    await disablePluginForApp(pluginId)
    expect(settings.selectedThemeId).toBe(LIGHT_THEME.id)
    expect(savedTheme).toBe(LIGHT_THEME.id)
    expect(themeLinks()).toEqual([])
    expect(document.querySelector('link[data-openforge-plugin-stylesheet]')).toBeNull()
  })

  it.each([disablePluginForApp, uninstallPlugin])('cancels pending selected CSS when the plugin is removed', async remove => {
    await activatePlugin(pluginId)
    const selecting = themeRegistry.selectTheme(themeId)
    await vi.waitFor(() => expect(themeLinks()).toHaveLength(2))
    const stale = themeLinks()
    await remove(pluginId)
    await selecting
    for (const link of stale) link.dispatchEvent(new Event('load'))
    expect(themeLinks()).toEqual([])
    expect(get(selectedTheme).id).toBe(LIGHT_THEME.id)
    expect(get(themeRegistry.availableThemes).some(theme => theme.id === themeId)).toBe(false)
  })

  it('removes only theme CSS when switching, and removes both styles on uninstall', async () => {
    await activatePlugin(pluginId)
    const selecting = themeRegistry.selectTheme(themeId)
    await finishStylesheets(0)
    await selecting
    const viewCSS = document.querySelector('link[data-openforge-plugin-stylesheet]')!
    await themeRegistry.selectTheme(LIGHT_THEME.id)
    expect(themeLinks()).toEqual([])
    expect(viewCSS.isConnected).toBe(true)
    const selectingAgain = themeRegistry.selectTheme(themeId)
    await finishStylesheets(0)
    await selectingAgain
    await uninstallPlugin(pluginId)
    expect(themeLinks()).toEqual([])
    expect(viewCSS.isConnected).toBe(false)
    expect(savedTheme).toBe(LIGHT_THEME.id)
  })

  it('does not restore a reloaded plugin theme over a newer user selection', async () => {
    await activatePlugin(pluginId)
    const selecting = themeRegistry.selectTheme(themeId)
    await finishStylesheets(0)
    await selecting
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    loader._setModuleLoader(async () => { await gate; return fixture })
    const reloading = reloadPluginForApp(pluginId)
    await vi.waitFor(() => expect(themeLinks()).toEqual([]))
    await themeRegistry.selectTheme(LIGHT_THEME.id)
    release!()
    await expect(reloading).resolves.toBe(true)
    expect(themeLinks()).toEqual([])
    expect(savedTheme).toBe(LIGHT_THEME.id)
  })

  it('restores a persisted qualified id after startup registration and stylesheet readiness', async () => {
    await activatePlugin(pluginId)
    const selecting = themeRegistry.selectTheme(themeId)
    await finishStylesheets(0)
    await selecting
    const saved = savedTheme
    const definition = get(selectedTheme)
    await deactivatePluginById(pluginId)
    const root = document.createElement('main')
    const restarted = createThemeRuntime({
      root, getStoredThemeId: async () => saved,
      persistThemeId: async id => { savedTheme = id },
    })
    const registration = restarted.registry.registerContributedTheme(definition, { pluginId, generation: 0 })
    const starting = restarted.initialize()
    await finishStylesheets(0)
    await starting
    expect(root.dataset.theme).toBe(themeId)
    expect(savedTheme).toBe(themeId)
    await registration.dispose()
    expect(themeLinks()).toEqual([])
  })
})
