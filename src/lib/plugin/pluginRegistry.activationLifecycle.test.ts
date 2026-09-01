import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  activatePluginLoaderMock,
  deactivatePluginById,
  deactivatePluginLoaderMock,
  defineFrontendPlugin,
  desktopEventHandlers,
  disablePluginForProject,
  emitPluginHostEvent,
  enabledPluginIds,
  executePluginCommand,
  fsWriteFileMock,
  get,
  getBuiltinPluginModuleMock,
  getPluginStorageMock,
  getRegisteredComponent,
  installedPlugins,
  listenDesktopEventMock,
  loadPluginFrontendMock,
  makeManifest,
  pluginInvokeMock,
  resetPluginRegistryTestState,
  runtimeContributionSources,
  setPluginStorageMock,
  spawnShellPtyMock,
} from './pluginRegistryTestSupport'
import type { FrontendOpenForgeAPI } from './pluginRegistryTestSupport'

describe('pluginRegistry activation lifecycle', () => {
  beforeEach(resetPluginRegistryTestState)

  it('deactivates backend-only plugins back to installed state', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.cjs',
    })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(activatePlugin('backend-plugin')).resolves.toBe(true)
    await deactivatePluginById('backend-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')).toMatchObject({
      state: 'installed',
      error: null,
    })
  })

  it('activatePlugin rejects legacy frontend activate(context) modules loudly', async () => {
    const manifest = makeManifest()
    const legacyModule = { activate: vi.fn() }
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: legacyModule })

    const result = await activatePlugin('test-plugin')

    expect(result).toBe(false)
    expect(loadPluginFrontendMock).toHaveBeenCalledWith('test-plugin', 'plugin://test-plugin/index.js')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(legacyModule.activate).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'Plugin test-plugin uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime',
    })
  })

  it('routes frontend plugin fs.writeFile through the typed renderer IPC wrapper', async () => {
    let api: FrontendOpenForgeAPI | undefined
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge) {
        api = openforge
      },
    })
    const manifest = makeManifest({ id: 'fs-write-plugin', frontend: './dist/frontend.js' })
    installedPlugins.set(new Map([['fs-write-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'fs-write-plugin',
        apiVersion: 1,
        displayName: 'Filesystem Write Plugin',
        description: 'Writes project files',
        frontend: './dist/frontend.js',
      },
    }]]))
    enabledPluginIds.set(new Set(['fs-write-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'fs-write-plugin', module: frontendPlugin })
    fsWriteFileMock.mockResolvedValue(undefined)

    await expect(activatePlugin('fs-write-plugin')).resolves.toBe(true)
    await api!.fs.writeFile({ projectId: 'P-1', path: 'generated/report.md', content: '# Report\n' })

    expect(fsWriteFileMock).toHaveBeenCalledWith('P-1', 'generated/report.md', '# Report\n')
  })

  it('activates builtin defineFrontendPlugin modules inside the host bundle instead of loading plugin:// frontend bundles', async () => {
    const Component = vi.fn() as never
    const activateBuiltin = vi.fn((openforge, context) => {
      context.subscriptions.add(openforge.views.register({
        id: 'main',
        title: 'Builtin Main',
        icon: 'plug',
        placement: 'rail',
        component: Component,
      }))
    })
    const manifest = makeManifest({ id: 'builtin-plugin', frontend: './dist/frontend.js' })
    installedPlugins.set(new Map([['builtin-plugin', { manifest, state: 'installed', error: null, isBuiltin: true }]]))
    enabledPluginIds.set(new Set(['builtin-plugin']))
    getBuiltinPluginModuleMock.mockReturnValue(defineFrontendPlugin({ activate: activateBuiltin }))

    await expect(activatePlugin('builtin-plugin')).resolves.toBe(true)

    expect(getBuiltinPluginModuleMock).toHaveBeenCalledWith('builtin-plugin')
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateBuiltin).toHaveBeenCalledOnce()
    expect(get(runtimeContributionSources).get('builtin-plugin')?.views).toMatchObject([
      { id: 'main', title: 'Builtin Main', icon: 'plug', placement: 'rail' },
    ])
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBe(Component)
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('active')

    await deactivatePluginById('builtin-plugin')

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:builtin-plugin:main')).toBeUndefined()
    expect(get(installedPlugins).get('builtin-plugin')?.state).toBe('installed')
  })

  it('rolls back runtime state when runtime registration validation fails', async () => {
    const viewComponent = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: viewComponent }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: async () => undefined }))
        openforge.commands.register({ id: 'open-demo', title: 'Duplicate', handler: async () => undefined })
      },
    })

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(false)

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    await expect(executePluginCommand('test-plugin', 'open-demo')).resolves.toBe(false)
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'Duplicate runtime contribution id: test-plugin.open-demo',
    })
  })

  it('rolls back partial activation when a plugin lacks the replacement capability', async () => {
    const viewComponent = vi.fn() as never
    const dashboardComponent = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge) {
        openforge.views.register({
          id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: viewComponent,
        })
        openforge.viewReplacements.register({
          id: 'dashboard',
          target: 'project.dashboard',
          title: 'Dashboard',
          icon: 'panels-top-left',
          component: dashboardComponent,
        })
      },
    })
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'test-plugin',
        apiVersion: 1,
        displayName: 'Test Plugin',
        description: 'Tests capability enforcement',
        frontend: './index.js',
        requires: ['views'],
      },
    }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(false)

    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    expect(get(installedPlugins).get('test-plugin')).toMatchObject({
      state: 'error',
      error: 'viewReplacements registration requires the viewReplacements capability',
    })
  })

  it('activatePlugin exposes runtime context, storage, and host event subscription APIs', async () => {
    const handler = vi.fn()
    let capturedApi: FrontendOpenForgeAPI | null = null
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        capturedApi = openforge
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    getPluginStorageMock.mockResolvedValue({ stored: true })
    setPluginStorageMock.mockResolvedValue(undefined)

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)

    const api = capturedApi as FrontendOpenForgeAPI | null
    if (api === null) {
      throw new Error('Expected runtime API to be passed to defineFrontendPlugin activate')
    }

    expect(api.context.getSnapshot()).toEqual({ pluginId: 'test-plugin', projectId: null })
    await expect(api.storage.global.get('plugin-key')).resolves.toEqual({ stored: true })
    expect(getPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'global', null, 'plugin-key')

    await api.storage.project('P-1').set('plugin-key', { plugin: 'value' })
    expect(setPluginStorageMock).toHaveBeenCalledWith('test-plugin', 'project', 'P-1', 'plugin-key', { plugin: 'value' })

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledWith({ selectedTaskId: 'T-123' })

    await deactivatePluginById('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('waits for terminal event listeners to be attached before spawning shell PTYs', async () => {
    let spawn: Promise<number> | null = null
    const outputHandler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.events.onGlobal('openforge.pty-output-T-1-shell-0', outputHandler))
        context.subscriptions.add(openforge.events.onGlobal('openforge.pty-exit-T-1-shell-0', vi.fn()))
        spawn = openforge.shell.spawn({
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 0,
        })
      },
    })
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    spawnShellPtyMock.mockResolvedValue(42)

    let resolveOutputListen: ((unlisten: () => void) => void) | null = null
    let resolveExitListen: ((unlisten: () => void) => void) | null = null
    listenDesktopEventMock.mockImplementation((event: string, handler: (event: { payload: unknown }) => void) => {
      desktopEventHandlers.set(event, handler)
      return new Promise<() => void>((resolve) => {
        if (event === 'pty-output-T-1-shell-0') {
          resolveOutputListen = resolve
        } else if (event === 'pty-exit-T-1-shell-0') {
          resolveExitListen = resolve
        } else {
          resolve(() => undefined)
        }
      })
    })

    await activatePlugin('test-plugin')
    await Promise.resolve()

    expect(spawn).not.toBeNull()
    expect(spawnShellPtyMock).not.toHaveBeenCalled()

    const outputResolver = resolveOutputListen as ((unlisten: () => void) => void) | null
    if (!outputResolver) throw new Error('Expected output listener registration to be pending')
    outputResolver(() => undefined)
    await Promise.resolve()
    expect(spawnShellPtyMock).not.toHaveBeenCalled()

    const exitResolver = resolveExitListen as ((unlisten: () => void) => void) | null
    if (!exitResolver) throw new Error('Expected exit listener registration to be pending')
    exitResolver(() => undefined)
    await expect(spawn).resolves.toBe(42)
    expect(spawnShellPtyMock).toHaveBeenCalledWith('T-1', '/tmp/worktree', 80, 24, 0, null)

    desktopEventHandlers.get('pty-output-T-1-shell-0')?.({ payload: { data: 'hello' } })
    expect(outputHandler).toHaveBeenCalledWith({ data: 'hello' })
  })

  it('deactivatePluginById clears runtime host event subscriptions and unregisters view components for the plugin', async () => {
    const manifest = makeManifest()
    const Component = vi.fn() as never
    const handler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: Component }))
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await activatePlugin('test-plugin')

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(Component)

    await deactivatePluginById('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })

    expect(deactivatePluginLoaderMock).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
  })

  it('activatePlugin returns false for plugin not in store', async () => {
    const result = await activatePlugin('nonexistent-plugin')
    expect(result).toBe(false)
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
  })

  it('activatePlugin dedupes concurrent activation for the same plugin', async () => {
    const manifest = makeManifest()
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    const activateFrontend = vi.fn(() => undefined)
    const frontendPlugin = defineFrontendPlugin({ activate: activateFrontend })
    let resolveLoad: (() => void) | undefined
    loadPluginFrontendMock.mockReturnValue(new Promise(resolve => {
      resolveLoad = () => resolve({ pluginId: 'test-plugin', module: frontendPlugin })
    }))

    const first = activatePlugin('test-plugin')
    const second = activatePlugin('test-plugin')
    await Promise.resolve()
    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
    resolveLoad?.()

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(activateFrontend).toHaveBeenCalledTimes(1)
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
  })

  it('clears runtime state when disabled during async activation even if subscription cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const manifest = makeManifest({ id: 'pending-activation-plugin' })
    const Component = vi.fn() as never
    let markActivationStarted: (() => void) | null = null
    let finishActivation: (() => void) | null = null
    const activationStarted = new Promise<void>((resolve) => {
      markActivationStarted = resolve
    })
    const activationGate = new Promise<void>((resolve) => {
      finishActivation = resolve
    })
    const frontendPlugin = defineFrontendPlugin({
      async activate(openforge, context) {
        markActivationStarted?.()
        await activationGate
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main',
          icon: 'sparkles',
          placement: 'rail',
          component: Component,
        }))
        context.subscriptions.add({
          dispose: async () => {
            throw new Error('subscription cleanup failed')
          },
        })
      },
    })
    installedPlugins.set(new Map([['pending-activation-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['pending-activation-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'pending-activation-plugin', module: frontendPlugin })

    const activation = activatePlugin('pending-activation-plugin')
    await activationStarted
    await disablePluginForProject('P-1', 'pending-activation-plugin')
    const releaseActivation = finishActivation as (() => void) | null
    if (!releaseActivation) throw new Error('Expected frontend activation to be pending')
    releaseActivation()

    await expect(activation).resolves.toBe(false)
    expect(getRegisteredComponent('plugin:pending-activation-plugin:main')).toBeUndefined()
    expect(get(runtimeContributionSources).get('pending-activation-plugin')).toBeUndefined()
    expect(get(installedPlugins).get('pending-activation-plugin')).toMatchObject({
      state: 'installed',
      error: null,
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[pluginActivationLifecycle] Failed to discard frontend runtime activation for pending-activation-plugin:',
      expect.objectContaining({ message: 'subscription cleanup failed' }),
    )
    consoleError.mockRestore()
  })
})
