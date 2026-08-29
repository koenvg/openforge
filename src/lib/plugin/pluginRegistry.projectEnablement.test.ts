import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  clearLoadedPluginMock,
  deactivatePluginLoaderMock,
  defineFrontendPlugin,
  disablePluginForProject,
  enablePluginForProject,
  enabledPluginIds,
  get,
  getEnabledPluginsMock,
  getPluginRenderProps,
  getRegisteredComponent,
  installFromLocal,
  installPluginFromLocalIpcMock,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  makeNormalized,
  pluginBackendDeactivateMock,
  pluginBackendWhenReadyMock,
  registryLoadEnabledForProject,
  resetPluginRegistryTestState,
  runtimeContributionSources,
} from './pluginRegistryTestSupport'
import { activeProjectId } from '../stores'

describe('pluginRegistry project enablement', () => {
  beforeEach(resetPluginRegistryTestState)

  it('loadEnabledForProject populates enabled set', async () => {
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('pa'), makeNormalized('pb')])
    await registryLoadEnabledForProject('proj1')
    const set = get(enabledPluginIds)
    expect(set.has('pa')).toBe(true)
    expect(set.has('pb')).toBe(true)
  })

  it('readies enabled backend plugins during project load without opening their view', async () => {
    const View = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'schedules',
          title: 'Task Schedules',
          icon: 'clock',
          placement: 'rail',
          component: View,
        }))
      },
    })
    const manifest = makeManifest({ id: 'scheduler-plugin', frontend: 'index.js', backend: 'backend.cjs' })
    installedPlugins.set(new Map([['scheduler-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('scheduler-plugin'), backendEntry: 'backend.cjs' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'scheduler-plugin', module: frontendPlugin })

    await registryLoadEnabledForProject('P-1')

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('scheduler-plugin', 'plugin://scheduler-plugin/index.js')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('scheduler-plugin', 'P-1')
    expect(get(installedPlugins).get('scheduler-plugin')).toMatchObject({ state: 'active', error: null })
  })

  it('retains an enabled project Plugin runtime when the Selected Project changes', async () => {
    const View = vi.fn() as never
    const activationProjectIds: Array<string | null> = []
    const dispose = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        activationProjectIds.push(openforge.context.getSnapshot().projectId)
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main',
          icon: 'plug',
          placement: 'rail',
          component: View,
        }))
        context.subscriptions.add({ dispose })
      },
    })
    const manifest = makeManifest({ id: 'project-runtime-plugin', frontend: 'index.js', backend: 'backend.cjs' })
    installedPlugins.set(new Map([['project-runtime-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('project-runtime-plugin'), backendEntry: 'backend.cjs' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'project-runtime-plugin', module: frontendPlugin })

    activeProjectId.set('P-1')
    await registryLoadEnabledForProject('P-1')
    activeProjectId.set('P-2')
    await registryLoadEnabledForProject('P-2')

    expect(activationProjectIds).toEqual(['P-1'])
    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:project-runtime-plugin:main')).toBe(View)
    expect(pluginBackendDeactivateMock).not.toHaveBeenCalled()
    expect(pluginBackendWhenReadyMock).toHaveBeenNthCalledWith(1, 'project-runtime-plugin', 'P-1')
    expect(pluginBackendWhenReadyMock).toHaveBeenNthCalledWith(2, 'project-runtime-plugin', 'P-2', true)
    expect(getPluginRenderProps('project-runtime-plugin', { projectId: 'P-2' }).api.context.getSnapshot()).toMatchObject({
      pluginId: 'project-runtime-plugin',
      projectId: 'P-2',
    })
  })

  it('notifies retained frontend Plugins when reconciled Project context changes', async () => {
    const contextChanges: Array<string | null> = []
    let disposeContextChanges: (() => void | Promise<void>) | undefined
    const frontendPlugin = defineFrontendPlugin({
      activate(_openforge, context) {
        const subscription = context.onDidChange((snapshot) => {
          contextChanges.push(snapshot.projectId)
        })
        disposeContextChanges = () => subscription.dispose()
        context.subscriptions.add(subscription)
      },
    })
    const manifest = makeManifest({ id: 'context-plugin', frontend: 'index.js', backend: null })
    installedPlugins.set(new Map([['context-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('context-plugin')])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'context-plugin', module: frontendPlugin })

    activeProjectId.set('P-1')
    await registryLoadEnabledForProject('P-1')
    activeProjectId.set('P-2')
    await registryLoadEnabledForProject('P-2')

    expect(contextChanges).toEqual(['P-2'])

    await disposeContextChanges?.()
    activeProjectId.set('P-3')
    await registryLoadEnabledForProject('P-3')

    expect(contextChanges).toEqual(['P-2'])
  })

  it('does not rebind or reactivate Plugins when the same Project is selected repeatedly', async () => {
    const manifest = makeManifest({ id: 'stable-plugin', frontend: null, backend: 'backend.cjs' })
    installedPlugins.set(new Map([['stable-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{
      ...makeNormalized('stable-plugin'),
      frontendEntry: null,
      backendEntry: 'backend.cjs',
    }])

    await registryLoadEnabledForProject('P-1')
    await registryLoadEnabledForProject('P-1')

    expect(getEnabledPluginsMock).toHaveBeenCalledTimes(2)
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledTimes(1)
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('stable-plugin', 'P-1')
    expect(pluginBackendDeactivateMock).not.toHaveBeenCalled()
  })

  it('reconciles retained, departing, and entering project Plugins from enablement differences', async () => {
    const backendOnlyEntry = (pluginId: string) => ({
      manifest: makeManifest({ id: pluginId, frontend: null, backend: 'backend.cjs' }),
      state: 'installed' as const,
      error: null,
    })
    installedPlugins.set(new Map([
      ['retained-plugin', backendOnlyEntry('retained-plugin')],
      ['departing-plugin', backendOnlyEntry('departing-plugin')],
      ['entering-plugin', backendOnlyEntry('entering-plugin')],
    ]))
    getEnabledPluginsMock.mockImplementation(async (projectId: string) => {
      const pluginIds = projectId === 'P-1'
        ? ['retained-plugin', 'departing-plugin']
        : ['retained-plugin', 'entering-plugin']
      return pluginIds.map(pluginId => ({
        ...makeNormalized(pluginId),
        frontendEntry: null,
        backendEntry: 'backend.cjs',
      }))
    })

    await registryLoadEnabledForProject('P-1')
    await registryLoadEnabledForProject('P-2')

    expect(pluginBackendDeactivateMock).toHaveBeenCalledTimes(1)
    expect(pluginBackendDeactivateMock).toHaveBeenCalledWith('departing-plugin')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('retained-plugin', 'P-2', true)
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('entering-plugin', 'P-2')
    expect(pluginBackendWhenReadyMock).not.toHaveBeenCalledWith('departing-plugin', 'P-2', true)
  })

  it('applies only the latest pending Selected Project while reconciliation is in flight', async () => {
    let releaseFirstLookup: (() => void) | undefined
    const firstLookupBlocked = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve
    })
    const backendOnlyEntry = (pluginId: string) => ({
      manifest: makeManifest({ id: pluginId, frontend: null, backend: 'backend.cjs' }),
      state: 'installed' as const,
      error: null,
    })
    installedPlugins.set(new Map([
      ['first-plugin', backendOnlyEntry('first-plugin')],
      ['skipped-plugin', backendOnlyEntry('skipped-plugin')],
      ['latest-plugin', backendOnlyEntry('latest-plugin')],
    ]))
    getEnabledPluginsMock.mockImplementation(async (projectId: string) => {
      if (projectId === 'P-1') await firstLookupBlocked
      const pluginId = projectId === 'P-1'
        ? 'first-plugin'
        : projectId === 'P-2' ? 'skipped-plugin' : 'latest-plugin'
      return [{
        ...makeNormalized(pluginId),
        frontendEntry: null,
        backendEntry: 'backend.cjs',
      }]
    })

    const first = registryLoadEnabledForProject('P-1')
    await vi.waitFor(() => expect(getEnabledPluginsMock).toHaveBeenCalledWith('P-1'))
    const skipped = registryLoadEnabledForProject('P-2')
    const latest = registryLoadEnabledForProject('P-3')
    releaseFirstLookup?.()
    await Promise.all([first, skipped, latest])

    expect(getEnabledPluginsMock.mock.calls.map(([projectId]) => projectId)).toEqual(['P-1', 'P-3'])
    expect(pluginBackendWhenReadyMock).not.toHaveBeenCalledWith('skipped-plugin', 'P-2')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('latest-plugin', 'P-3')
  })

  it('coalesces retained Plugin context notifications with rapid Project selections', async () => {
    let releaseFirstLookup: (() => void) | undefined
    const firstLookupBlocked = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve
    })
    const contextChanges: Array<string | null> = []
    const frontendPlugin = defineFrontendPlugin({
      activate(_openforge, context) {
        context.subscriptions.add(context.onDidChange((snapshot) => {
          contextChanges.push(snapshot.projectId)
        }))
      },
    })
    const manifest = makeManifest({ id: 'context-plugin', frontend: 'index.js', backend: null })
    installedPlugins.set(new Map([['context-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'context-plugin', module: frontendPlugin })
    getEnabledPluginsMock.mockImplementation(async (projectId: string) => {
      if (projectId === 'P-1') await firstLookupBlocked
      return [makeNormalized('context-plugin')]
    })

    activeProjectId.set('P-1')
    const first = registryLoadEnabledForProject('P-1')
    await vi.waitFor(() => expect(getEnabledPluginsMock).toHaveBeenCalledWith('P-1'))
    activeProjectId.set('P-2')
    const skipped = registryLoadEnabledForProject('P-2')
    activeProjectId.set('P-3')
    const latest = registryLoadEnabledForProject('P-3')
    releaseFirstLookup?.()
    await Promise.all([first, skipped, latest])

    expect(contextChanges).toEqual(['P-3'])
    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
  })

  it('continues reconciling later Projects after a retained backend context update fails', async () => {
    const manifest = makeManifest({ id: 'recovering-plugin', frontend: null, backend: 'backend.cjs' })
    installedPlugins.set(new Map([['recovering-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{
      ...makeNormalized('recovering-plugin'),
      frontendEntry: null,
      backendEntry: 'backend.cjs',
    }])
    pluginBackendWhenReadyMock.mockImplementation(async (_pluginId, projectId, preserveActivation) => {
      if (projectId === 'P-2' && preserveActivation) {
        throw new Error('context update failed')
      }
    })

    await registryLoadEnabledForProject('P-1')
    await expect(registryLoadEnabledForProject('P-2')).rejects.toThrow('context update failed')
    await expect(registryLoadEnabledForProject('P-3')).resolves.toBeUndefined()

    expect(pluginBackendWhenReadyMock).toHaveBeenLastCalledWith('recovering-plugin', 'P-3', true)
    expect(get(installedPlugins).get('recovering-plugin')?.state).toBe('active')
  })

  it('deactivates project-scoped Plugin runtimes when no Project is visible', async () => {
    const dispose = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(_openforge, context) {
        context.subscriptions.add({ dispose })
      },
    })
    const manifest = makeManifest({ id: 'project-runtime-plugin', frontend: 'index.js', backend: 'backend.cjs' })
    installedPlugins.set(new Map([['project-runtime-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('project-runtime-plugin'), backendEntry: 'backend.cjs' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'project-runtime-plugin', module: frontendPlugin })

    activeProjectId.set('P-1')
    await registryLoadEnabledForProject('P-1')
    activeProjectId.set(null)
    await registryLoadEnabledForProject(null)

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pluginBackendDeactivateMock).toHaveBeenCalledTimes(1)
    expect(get(installedPlugins).get('project-runtime-plugin')).toMatchObject({ state: 'installed', error: null })
    expect(get(runtimeContributionSources).has('project-runtime-plugin')).toBe(false)
    expect(get(enabledPluginIds)).toEqual(new Set())
  })

  it('does not request backend readiness for enabled frontend-only plugins', async () => {
    const View = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main',
          icon: 'plug',
          placement: 'rail',
          component: View,
        }))
      },
    })
    const manifest = makeManifest({ id: 'frontend-only-plugin', frontend: 'index.js', backend: null })
    installedPlugins.set(new Map([['frontend-only-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([makeNormalized('frontend-only-plugin')])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'frontend-only-plugin', module: frontendPlugin })

    await registryLoadEnabledForProject('P-1')

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('frontend-only-plugin', 'plugin://frontend-only-plugin/index.js')
    expect(pluginBackendWhenReadyMock).not.toHaveBeenCalled()
  })

  it('readies a backend plugin when it is enabled for a project', async () => {
    const View = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Backend Plugin',
          icon: 'plug',
          placement: 'rail',
          component: View,
        }))
      },
    })
    const manifest = makeManifest({ id: 'enabled-backend-plugin', frontend: 'index.js', backend: 'backend.cjs' })
    installedPlugins.set(new Map([['enabled-backend-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'enabled-backend-plugin', module: frontendPlugin })

    await expect(enablePluginForProject('P-1', 'enabled-backend-plugin')).resolves.toBe(true)

    expect(get(enabledPluginIds)).toEqual(new Set(['enabled-backend-plugin']))
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('enabled-backend-plugin', 'P-1')
  })

  it('records backend readiness failures in the existing plugin runtime error state', async () => {
    const View = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Backend Plugin',
          icon: 'plug',
          placement: 'rail',
          component: View,
        }))
      },
    })
    const manifest = makeManifest({ id: 'failing-backend-plugin', frontend: 'index.js', backend: 'backend.cjs' })
    installedPlugins.set(new Map([['failing-backend-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('failing-backend-plugin'), backendEntry: 'backend.cjs' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'failing-backend-plugin', module: frontendPlugin })
    pluginBackendWhenReadyMock.mockRejectedValueOnce(new Error('backend failed'))

    await registryLoadEnabledForProject('P-1')

    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('failing-backend-plugin', 'P-1')
    expect(get(installedPlugins).get('failing-backend-plugin')).toMatchObject({ state: 'error', error: 'backend failed' })
  })

  it('activates package plugins immediately when enabling and deactivates them when disabling', async () => {
    const RuntimeView = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main View',
          icon: 'sparkles',
          placement: 'rail',
          component: RuntimeView,
        }))
      },
    })
    const manifest = makeManifest({ id: 'enable-runtime-plugin', frontend: './dist/frontend.js' })
    installedPlugins.set(new Map([['enable-runtime-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'enable-runtime-plugin',
        apiVersion: 1,
        displayName: 'Enable Runtime Plugin',
        description: 'Runtime package plugin',
        frontend: './dist/frontend.js',
      },
    }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'enable-runtime-plugin', module: frontendPlugin })

    await expect(enablePluginForProject('P-1', 'enable-runtime-plugin')).resolves.toBe(true)

    expect(get(enabledPluginIds)).toEqual(new Set(['enable-runtime-plugin']))
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('active')
    expect(get(runtimeContributionSources).get('enable-runtime-plugin')?.views).toMatchObject([
      { id: 'main', title: 'Main View' },
    ])

    await disablePluginForProject('P-1', 'enable-runtime-plugin')

    expect(get(enabledPluginIds)).toEqual(new Set())
    expect(clearLoadedPluginMock).toHaveBeenCalledWith('enable-runtime-plugin')
    expect(get(installedPlugins).get('enable-runtime-plugin')?.state).toBe('installed')
    expect(get(runtimeContributionSources).get('enable-runtime-plugin')).toBeUndefined()
  })

  it('loads declared Svelte styles when an installed local plugin is enabled', async () => {
    const frontendPlugin = defineFrontendPlugin({ activate: vi.fn(() => undefined) })
    installPluginFromLocalIpcMock.mockResolvedValue({
      ...makeNormalized('local-svelte-plugin'),
      frontendEntry: './dist/frontend.js',
      sourceKind: 'local',
      sourceSpec: '/plugins/local-svelte-plugin',
      packageMetadata: JSON.stringify({
        id: 'local-svelte-plugin',
        apiVersion: 1,
        displayName: 'Local Svelte Plugin',
        description: 'Styled local plugin',
        frontend: './dist/frontend.js',
        frontendStyles: ['./dist/plugin-local-svelte.css'],
      }),
    })
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'local-svelte-plugin', module: frontendPlugin })

    await installFromLocal('/plugins/local-svelte-plugin', 'project-1')
    await expect(enablePluginForProject('project-1', 'local-svelte-plugin')).resolves.toBe(true)

    expect(loadPluginFrontendMock).toHaveBeenCalledWith(
      'local-svelte-plugin',
      'plugin://local-svelte-plugin/dist/frontend.js',
      ['plugin://local-svelte-plugin/dist/plugin-local-svelte.css'],
    )
  })

  it('disabling a plugin reconciles active lifecycle state and unregisters its views', async () => {
    const manifest = makeManifest()
    const Component = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: Component }))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'active', error: null }]]))
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    await disablePluginForProject('P-1', 'test-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })

  it('coalesces a synchronous burst of store writes into a single reconcile teardown', async () => {
    const manifest = makeManifest({ id: 'burst-plugin' })
    deactivatePluginLoaderMock.mockResolvedValue(undefined)

    // Plugin is active in the store but no longer enabled: reconcile must deactivate it.
    // Several transient writes land in the same tick (as happens during activation via
    // setPluginRuntimeState). Each write notifies the reconcile subscribers, but they must
    // coalesce into a single pass rather than spawning overlapping async reconciles that all
    // read the same 'active' snapshot and tear the plugin down concurrently.
    enabledPluginIds.set(new Set())
    for (let i = 0; i < 5; i++) {
      installedPlugins.set(new Map([['burst-plugin', { manifest, state: 'active', error: null }]]))
    }

    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(deactivatePluginLoaderMock).toHaveBeenCalledTimes(1)
    expect(get(installedPlugins).get('burst-plugin')).toMatchObject({ state: 'installed' })
  })
})
