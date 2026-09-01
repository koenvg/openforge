import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  activatePluginLoaderMock,
  clearLoadedPluginMock,
  deactivatePluginLoaderMock,
  defineFrontendPlugin,
  enabledPluginIds,
  get,
  getEnabledPluginsMock,
  getPluginIpcMock,
  getRegisteredComponent,
  installPluginFromLocalIpcMock,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  makeNormalized,
  pluginBackendDeactivateMock,
  pluginBackendWhenReadyMock,
  reloadInstalledPluginMetadata,
  reloadLocalPluginFromDisk,
  reloadPluginForProject,
  resetPluginRegistryTestState,
} from './pluginRegistryTestSupport'
import { publishTaskInvalidation } from './pluginTaskInvalidations'

describe('pluginRegistry reload lifecycle', () => {
  beforeEach(resetPluginRegistryTestState)

  it('reloadInstalledPluginMetadata refreshes global install state without project activation', async () => {
    const manifest = makeManifest({ id: 'reload-plugin' })
    enabledPluginIds.set(new Set(['reload-plugin']))
    installedPlugins.set(new Map([['reload-plugin', { manifest, state: 'active', error: 'old error' }]]))
    getPluginIpcMock.mockResolvedValue({
      ...makeNormalized('reload-plugin'),
      name: 'Reloaded Plugin',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })

    await expect(reloadInstalledPluginMetadata('reload-plugin')).resolves.toBe(true)

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getEnabledPluginsMock).not.toHaveBeenCalled()
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('reload-plugin')).toMatchObject({
      state: 'active',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      error: null,
    })
  })

  it('reloadPluginForProject waits for pending activation cleanup before activating refreshed artifacts', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: './dist/frontend.js' })
    const StaleComponent = vi.fn() as never
    const RefreshedComponent = vi.fn() as never
    let markActivationStarted: (() => void) | null = null
    let finishActivation: (() => void) | null = null
    const activationStarted = new Promise<void>((resolve) => {
      markActivationStarted = resolve
    })
    const activationGate = new Promise<void>((resolve) => {
      finishActivation = resolve
    })
    const staleFrontendPlugin = defineFrontendPlugin({
      async activate(openforge, context) {
        markActivationStarted?.()
        await activationGate
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Stale Main',
          icon: 'sparkles',
          placement: 'rail',
          component: StaleComponent,
        }))
      },
    })
    const refreshedFrontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Refreshed Main',
          icon: 'sparkles',
          placement: 'rail',
          component: RefreshedComponent,
        }))
      },
    })
    installedPlugins.set(new Map([['reload-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['reload-plugin']))
    getPluginIpcMock.mockResolvedValue(makeNormalized('reload-plugin'))
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('reload-plugin')])
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: staleFrontendPlugin })
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: refreshedFrontendPlugin })

    const pendingActivation = activatePlugin('reload-plugin')
    await activationStarted
    const reload = reloadPluginForProject('project-1', 'reload-plugin')
    await Promise.resolve()
    await Promise.resolve()

    const releaseActivation = finishActivation as (() => void) | null
    if (!releaseActivation) throw new Error('Expected frontend activation to be pending')
    releaseActivation()

    await expect(pendingActivation).resolves.toBe(false)
    await expect(reload).resolves.toBe(true)
    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(2)
    expect(getRegisteredComponent('plugin:reload-plugin:main')).toBe(RefreshedComponent)
    expect(get(installedPlugins).get('reload-plugin')).toMatchObject({
      state: 'active',
      error: null,
    })
  })

  it('reloadPluginForProject re-imports changed local frontend bundles with a cache-busted URL', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: './dist/frontend.js' })
    const packageMetadata = {
      id: 'reload-plugin',
      apiVersion: 1 as const,
      displayName: 'Reload Plugin',
      description: 'Reload plugin',
      frontend: './dist/frontend.js',
      frontendStyles: ['./dist/reload-plugin.css'],
    }
    enabledPluginIds.set(new Set(['reload-plugin']))
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'installed',
      error: null,
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      packageMetadata,
    }]]))
    getPluginIpcMock.mockResolvedValue({
      ...makeNormalized('reload-plugin'),
      frontendEntry: './dist/frontend.js',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      packageMetadata: JSON.stringify(packageMetadata),
    })
    getEnabledPluginsMock.mockResolvedValue([{
      ...makeNormalized('reload-plugin'),
      frontendEntry: './dist/frontend.js',
      packageMetadata: JSON.stringify(packageMetadata),
    }])
    const firstActivate = vi.fn(() => undefined)
    const secondActivate = vi.fn(() => undefined)
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: defineFrontendPlugin({ activate: firstActivate }) })
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: defineFrontendPlugin({ activate: secondActivate }) })

    await expect(activatePlugin('reload-plugin')).resolves.toBe(true)
    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(clearLoadedPluginMock).toHaveBeenCalledWith('reload-plugin')
    expect(loadPluginFrontendMock).toHaveBeenNthCalledWith(
      1,
      'reload-plugin',
      'plugin://reload-plugin/dist/frontend.js',
      ['plugin://reload-plugin/dist/reload-plugin.css'],
    )
    expect(loadPluginFrontendMock).toHaveBeenNthCalledWith(
      2,
      'reload-plugin',
      'plugin://reload-plugin/dist/frontend.js?openforgeReload=1',
      ['plugin://reload-plugin/dist/reload-plugin.css?openforgeReload=1'],
    )
    expect(firstActivate).toHaveBeenCalledOnce()
    expect(secondActivate).toHaveBeenCalledOnce()
  })


  it('reloadPluginForProject replaces Task invalidation subscriptions', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: './dist/frontend.js' })
    const staleHandler = vi.fn()
    const refreshedHandler = vi.fn()
    const pluginWithHandler = (handler: (event: unknown) => void) => defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.tasks.onDidChange('project-1', handler))
      },
    })
    installedPlugins.set(new Map([['reload-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['reload-plugin']))
    getPluginIpcMock.mockResolvedValue(makeNormalized('reload-plugin'))
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('reload-plugin')])
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: pluginWithHandler(staleHandler) })
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: pluginWithHandler(refreshedHandler) })

    await activatePlugin('reload-plugin', 'project-1')
    publishTaskInvalidation({ projectId: 'project-1', taskId: 'T-1', reason: 'created' })
    await reloadPluginForProject('project-1', 'reload-plugin')
    publishTaskInvalidation({ projectId: 'project-1', taskId: 'T-1', reason: 'updated' })

    expect(staleHandler).toHaveBeenCalledOnce()
    expect(refreshedHandler).toHaveBeenCalledOnce()
  })
  it('reloadPluginForProject deactivates the backend before refreshing installed artifacts', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: null, backend: './dist/backend.cjs' })
    enabledPluginIds.set(new Set(['reload-plugin']))
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'active',
      error: null,
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    }]]))
    getPluginIpcMock.mockResolvedValue({
      ...makeNormalized('reload-plugin'),
      frontendEntry: null,
      backendEntry: './dist/backend.cjs',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    getEnabledPluginsMock.mockResolvedValue([{
      ...makeNormalized('reload-plugin'),
      frontendEntry: null,
      backendEntry: './dist/backend.cjs',
    }])

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(pluginBackendDeactivateMock).toHaveBeenCalledWith('reload-plugin')
    expect(pluginBackendDeactivateMock.mock.invocationCallOrder[0]).toBeLessThan(getPluginIpcMock.mock.invocationCallOrder[0])
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('reload-plugin', 'project-1')
  })

  it('reloadPluginForProject releases live browser resources even when backend deactivation fails', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', backend: './dist/backend.cjs' })
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'active',
      error: null,
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    }]]))
    const invoke = vi.fn(async () => ({ ok: true, value: undefined }))
    window.openforge = { version: 1, invoke, onEvent: () => () => undefined }
    pluginBackendDeactivateMock.mockRejectedValue(new Error('backend deactivation failed'))

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).rejects.toThrow('backend deactivation failed')

    expect(invoke).toHaveBeenCalledWith('task_browser_surface_destroy_plugin', { pluginId: 'reload-plugin' })
    expect(getPluginIpcMock).not.toHaveBeenCalled()
    expect(getEnabledPluginsMock).not.toHaveBeenCalled()
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
  })

  it('reloadPluginForProject refreshes target metadata and preserves other active plugins', async () => {
    const reloadManifest = makeManifest({ id: 'reload-plugin' })
    const otherManifest = makeManifest({ id: 'other-plugin' })
    enabledPluginIds.set(new Set(['reload-plugin', 'other-plugin']))
    installedPlugins.set(new Map([
      ['reload-plugin', { manifest: reloadManifest, state: 'active', error: 'old error' }],
      ['other-plugin', { manifest: otherManifest, state: 'active', error: null }],
    ]))
    getPluginIpcMock.mockResolvedValue({
      ...makeNormalized('reload-plugin'),
      name: 'Reloaded Plugin',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('reload-plugin'), makeNormalized('other-plugin')])
    const frontendPlugin = defineFrontendPlugin({ activate: vi.fn(() => undefined) })
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'reload-plugin', module: frontendPlugin })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('reload-plugin')
    expect(getPluginIpcMock).toHaveBeenCalledWith('reload-plugin')
    expect(getEnabledPluginsMock).toHaveBeenCalledWith('project-1')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('reload-plugin')).toMatchObject({
      state: 'active',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    expect(get(installedPlugins).get('other-plugin')).toMatchObject({
      state: 'active',
      error: null,
    })
  })

  it('reloadLocalPluginFromDisk re-reads the package so the recorded version catches up with the folder', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', version: '1.0.0' })
    const rebuiltRow = {
      ...makeNormalized('reload-plugin'),
      version: '1.1.0',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      installPath: '/plugins/reload-plugin',
    }
    enabledPluginIds.set(new Set(['reload-plugin']))
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'active',
      error: null,
      sourceKind: 'local',
      installPath: '/plugins/reload-plugin',
    }]]))
    installPluginFromLocalIpcMock.mockResolvedValue(rebuiltRow)
    getPluginIpcMock.mockResolvedValue(rebuiltRow)
    getEnabledPluginsMock.mockResolvedValue([rebuiltRow])
    loadPluginFrontendMock.mockResolvedValue({
      pluginId: 'reload-plugin',
      module: defineFrontendPlugin({ activate: vi.fn(() => undefined) }),
    })

    await reloadLocalPluginFromDisk('reload-plugin', '/plugins/reload-plugin', 'project-1')

    expect(installPluginFromLocalIpcMock).toHaveBeenCalledWith('/plugins/reload-plugin')
    expect(get(installedPlugins).get('reload-plugin')?.manifest.version).toBe('1.1.0')
  })

  it('reloadLocalPluginFromDisk cache-busts the frontend import so a rebuilt bundle replaces the cached one', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: './dist/frontend.js' })
    const row = {
      ...makeNormalized('reload-plugin'),
      frontendEntry: './dist/frontend.js',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      installPath: '/plugins/reload-plugin',
    }
    enabledPluginIds.set(new Set(['reload-plugin']))
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'installed',
      error: null,
      sourceKind: 'local',
      installPath: '/plugins/reload-plugin',
    }]]))
    installPluginFromLocalIpcMock.mockResolvedValue(row)
    getPluginIpcMock.mockResolvedValue(row)
    getEnabledPluginsMock.mockResolvedValue([row])
    const staleActivate = vi.fn(() => undefined)
    const rebuiltActivate = vi.fn(() => undefined)
    loadPluginFrontendMock
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: defineFrontendPlugin({ activate: staleActivate }) })
      .mockResolvedValueOnce({ pluginId: 'reload-plugin', module: defineFrontendPlugin({ activate: rebuiltActivate }) })

    await expect(activatePlugin('reload-plugin')).resolves.toBe(true)
    await reloadLocalPluginFromDisk('reload-plugin', '/plugins/reload-plugin', 'project-1')

    expect(loadPluginFrontendMock).toHaveBeenNthCalledWith(1, 'reload-plugin', 'plugin://reload-plugin/dist/frontend.js')
    expect(loadPluginFrontendMock).toHaveBeenNthCalledWith(
      2,
      'reload-plugin',
      'plugin://reload-plugin/dist/frontend.js?openforgeReload=1',
    )
    expect(rebuiltActivate).toHaveBeenCalledOnce()
  })

  it('reloadLocalPluginFromDisk cycles a plugin with no active project so the next activation re-imports', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: './dist/frontend.js' })
    const row = {
      ...makeNormalized('reload-plugin'),
      frontendEntry: './dist/frontend.js',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
      installPath: '/plugins/reload-plugin',
    }
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'installed',
      error: null,
      sourceKind: 'local',
      installPath: '/plugins/reload-plugin',
    }]]))
    enabledPluginIds.set(new Set(['reload-plugin']))
    installPluginFromLocalIpcMock.mockResolvedValue(row)
    loadPluginFrontendMock.mockResolvedValue({
      pluginId: 'reload-plugin',
      module: defineFrontendPlugin({ activate: vi.fn(() => undefined) }),
    })

    await expect(activatePlugin('reload-plugin')).resolves.toBe(true)
    await reloadLocalPluginFromDisk('reload-plugin', '/plugins/reload-plugin', null)

    // No project to reactivate into, but the generation bump means whichever project is
    // opened next imports the rebuilt bundle instead of the one pinned in the module cache.
    expect(getPluginIpcMock).not.toHaveBeenCalled()
    await expect(activatePlugin('reload-plugin')).resolves.toBe(true)
    expect(loadPluginFrontendMock).toHaveBeenNthCalledWith(
      2,
      'reload-plugin',
      'plugin://reload-plugin/dist/frontend.js?openforgeReload=1',
    )
  })

  it('reloadLocalPluginFromDisk surfaces a package that no longer installs instead of reporting success', async () => {
    const manifest = makeManifest({ id: 'reload-plugin' })
    installedPlugins.set(new Map([['reload-plugin', {
      manifest,
      state: 'active',
      error: null,
      sourceKind: 'local',
      installPath: '/plugins/reload-plugin',
    }]]))
    installPluginFromLocalIpcMock.mockRejectedValue(new Error('OpenForge plugin frontend entry is missing'))

    await expect(reloadLocalPluginFromDisk('reload-plugin', '/plugins/reload-plugin', 'project-1'))
      .rejects.toThrow('OpenForge plugin frontend entry is missing')
    expect(getPluginIpcMock).not.toHaveBeenCalled()
  })
})
