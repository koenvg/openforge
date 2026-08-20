import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const {
  forceGithubSyncMock,
  installPluginMock,
  getPluginIpcMock,
  listPluginsMock,
  installPluginFromGitIpcMock,
  installPluginFromLocalIpcMock,
  installPluginFromNpmIpcMock,
  uninstallPluginIpcMock,
  getEnabledPluginsMock,
  pluginInvokeMock,
  pluginBackendDeactivateMock,
  pluginBackendWhenReadyMock,
  getPluginStorageMock,
  setPluginStorageMock,
  deletePluginStorageMock,
  spawnShellPtyMock,
  openUrlMock,
  writeClipboardTextMock,
  fsReadDirMock,
  fsReadFileMock,
  fsSearchFilesMock,
  getConfigMock,
  setConfigMock,
  getProjectConfigMock,
  setProjectConfigMock,
} = vi.hoisted(() => ({
  forceGithubSyncMock: vi.fn(),
  installPluginMock: vi.fn(),
  getPluginIpcMock: vi.fn(),
  listPluginsMock: vi.fn(),
  installPluginFromGitIpcMock: vi.fn(),
  installPluginFromLocalIpcMock: vi.fn(),
  installPluginFromNpmIpcMock: vi.fn(),
  uninstallPluginIpcMock: vi.fn(),
  getEnabledPluginsMock: vi.fn(),
  pluginInvokeMock: vi.fn(),
  pluginBackendDeactivateMock: vi.fn(),
  pluginBackendWhenReadyMock: vi.fn(),
  getPluginStorageMock: vi.fn(),
  setPluginStorageMock: vi.fn(),
  deletePluginStorageMock: vi.fn(),
  spawnShellPtyMock: vi.fn(),
  openUrlMock: vi.fn(),
  writeClipboardTextMock: vi.fn(),
  fsReadDirMock: vi.fn(),
  fsReadFileMock: vi.fn(),
  fsSearchFilesMock: vi.fn(),
  getConfigMock: vi.fn(),
  setConfigMock: vi.fn(),
  getProjectConfigMock: vi.fn(),
  setProjectConfigMock: vi.fn(),
}))

vi.mock('../ipc', () => ({
  forceGithubSync: forceGithubSyncMock,
  registerBuiltinPlugin: installPluginMock,
  uninstallPlugin: uninstallPluginIpcMock,
  getEnabledPlugins: getEnabledPluginsMock,
  getPlugin: getPluginIpcMock,
  listPlugins: listPluginsMock,
  setPluginEnabled: vi.fn(),
  installPluginFromGit: installPluginFromGitIpcMock,
  installPluginFromLocal: installPluginFromLocalIpcMock,
  installPluginFromNpm: installPluginFromNpmIpcMock,
  pluginInvoke: pluginInvokeMock,
  pluginBackendDeactivate: pluginBackendDeactivateMock,
  pluginBackendWhenReady: pluginBackendWhenReadyMock,
  getPluginStorage: getPluginStorageMock,
  setPluginStorage: setPluginStorageMock,
  deletePluginStorage: deletePluginStorageMock,
  spawnShellPty: spawnShellPtyMock,
  openUrl: openUrlMock,
  writeClipboardText: writeClipboardTextMock,
  fsReadDir: fsReadDirMock,
  fsReadFile: fsReadFileMock,
  fsSearchFiles: fsSearchFilesMock,
  getConfig: getConfigMock,
  setConfig: setConfigMock,
  getProjectConfig: getProjectConfigMock,
  setProjectConfig: setProjectConfigMock,
}))

const {
  loadPluginFrontendMock,
  activatePluginLoaderMock,
  deactivatePluginLoaderMock,
  clearLoadedPluginMock,
  isPluginLoadedMock,
  getBuiltinPluginModuleMock,
} = vi.hoisted(() => ({
  loadPluginFrontendMock: vi.fn(),
  activatePluginLoaderMock: vi.fn(),
  deactivatePluginLoaderMock: vi.fn(),
  clearLoadedPluginMock: vi.fn(),
  isPluginLoadedMock: vi.fn(),
  getBuiltinPluginModuleMock: vi.fn(),
}))

vi.mock('./pluginLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pluginLoader')>()

  return {
    ...actual,
    loadPluginFrontend: loadPluginFrontendMock,
    activatePlugin: activatePluginLoaderMock,
    deactivatePlugin: deactivatePluginLoaderMock,
    clearLoadedPlugin: clearLoadedPluginMock,
    isPluginLoaded: isPluginLoadedMock,
  }
})

const {
  listenDesktopEventMock,
  desktopEventHandlers,
} = vi.hoisted(() => ({
  listenDesktopEventMock: vi.fn(),
  desktopEventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('../desktopIpc', () => ({
  listenDesktopEvent: listenDesktopEventMock,
}))

vi.mock('./builtinPluginModules', () => ({
  getBuiltinPluginModule: getBuiltinPluginModuleMock,
}))

import {
  deactivatePluginById,
  emitPluginHostEvent,
  executePluginCommand,
  initializePluginRuntime,
  installPluginFromManifest,
  installPluginFromGit,
  installPluginFromNpm,
  uninstallPlugin,
  loadEnabledForProject as registryLoadEnabledForProject,
  activatePlugin,
  installFromLocal,
  getPluginRenderProps,
  enablePluginForProject,
  disablePluginForProject,
  reloadInstalledPluginMetadata,
  reloadLocalPluginFromDisk,
  reloadPluginForProject,
} from './pluginRegistry'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from './pluginStore'
import { _resetPluginActivationLifecycleForTests } from './pluginActivationLifecycle'
import type { PluginManifest } from './types'
import type { NormalizedPluginRow } from '../ipc'
import { clearComponentRegistry, getRegisteredComponent, getRegisteredRenderableComponent } from './componentRegistry'
import {
  applyRuntimeSnapshotContributions,
  getPluginCommandHandler,
} from './pluginRuntimeContributions'
import type { RuntimeContributionSnapshot } from './runtimeContributionRegistry'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A test plugin',
    permissions: [],
    frontend: 'index.js',
    backend: null,
    ...overrides,
  }
}

function makeNormalized(id: string): NormalizedPluginRow {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test',
    permissions: '[]',
    contributes: '{}',
    frontendEntry: 'index.js',
    backendEntry: null,
    installPath: '/tmp/plugin',
    sourceKind: 'legacy',
    sourceSpec: '',
    packageMetadata: '{}',
    installedAt: 0,
    isBuiltin: false,
  }
}

describe('pluginRegistry', () => {
  beforeEach(() => {
    delete window.openforge
    installPluginMock.mockReset()
    forceGithubSyncMock.mockReset()
    getPluginIpcMock.mockReset()
    listPluginsMock.mockReset()
    listPluginsMock.mockResolvedValue([])
    installPluginFromGitIpcMock.mockReset()
    installPluginFromLocalIpcMock.mockReset()
    installPluginFromNpmIpcMock.mockReset()
    uninstallPluginIpcMock.mockReset()
    getEnabledPluginsMock.mockReset()
    pluginInvokeMock.mockReset()
    pluginInvokeMock.mockResolvedValue(undefined)
    pluginBackendDeactivateMock.mockReset()
    pluginBackendDeactivateMock.mockResolvedValue(undefined)
    pluginBackendWhenReadyMock.mockReset()
    pluginBackendWhenReadyMock.mockResolvedValue(undefined)
    getPluginStorageMock.mockReset()
    setPluginStorageMock.mockReset()
    deletePluginStorageMock.mockReset()
    spawnShellPtyMock.mockReset()
    openUrlMock.mockReset()
    openUrlMock.mockResolvedValue(undefined)
    fsReadDirMock.mockReset()
    fsReadFileMock.mockReset()
    fsSearchFilesMock.mockReset()
    getConfigMock.mockReset()
    setConfigMock.mockReset()
    getProjectConfigMock.mockReset()
    setProjectConfigMock.mockReset()
    listenDesktopEventMock.mockReset()
    desktopEventHandlers.clear()
    listenDesktopEventMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      desktopEventHandlers.set(event, handler)
      return vi.fn()
    })
    loadPluginFrontendMock.mockReset()
    activatePluginLoaderMock.mockReset()
    deactivatePluginLoaderMock.mockReset()
    clearLoadedPluginMock.mockReset()
    isPluginLoadedMock.mockReset()
    getBuiltinPluginModuleMock.mockReset()
    _resetPluginActivationLifecycleForTests()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
  })

  it('installPluginFromManifest rejects legacy manifest installs loudly', async () => {
    const manifest = makeManifest()

    await expect(installPluginFromManifest(manifest, '/plugins/test-plugin')).rejects.toThrow(
      'Legacy manifest.json plugin installation is no longer supported'
    )
    expect(installPluginMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).has('test-plugin')).toBe(false)
  })

  it('uninstallPlugin removes from store', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(false)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    await uninstallPlugin('test-plugin')
    expect(uninstallPluginIpcMock).toHaveBeenCalledWith('test-plugin')
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
    const manifest = makeManifest({ id: 'scheduler-plugin', frontend: 'index.js', backend: 'backend.js' })
    installedPlugins.set(new Map([['scheduler-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('scheduler-plugin'), backendEntry: 'backend.js' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'scheduler-plugin', module: frontendPlugin })

    await registryLoadEnabledForProject('P-1')

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('scheduler-plugin', 'plugin://scheduler-plugin/index.js')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('scheduler-plugin')
    expect(get(installedPlugins).get('scheduler-plugin')).toMatchObject({ state: 'active', error: null })
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
    const manifest = makeManifest({ id: 'enabled-backend-plugin', frontend: 'index.js', backend: 'backend.js' })
    installedPlugins.set(new Map([['enabled-backend-plugin', { manifest, state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'enabled-backend-plugin', module: frontendPlugin })

    await expect(enablePluginForProject('P-1', 'enabled-backend-plugin')).resolves.toBe(true)

    expect(get(enabledPluginIds)).toEqual(new Set(['enabled-backend-plugin']))
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('enabled-backend-plugin')
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
    const manifest = makeManifest({ id: 'failing-backend-plugin', frontend: 'index.js', backend: 'backend.js' })
    installedPlugins.set(new Map([['failing-backend-plugin', { manifest, state: 'installed', error: null }]]))
    getEnabledPluginsMock.mockResolvedValue([{ ...makeNormalized('failing-backend-plugin'), backendEntry: 'backend.js' }])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'failing-backend-plugin', module: frontendPlugin })
    pluginBackendWhenReadyMock.mockRejectedValueOnce(new Error('backend failed'))

    await registryLoadEnabledForProject('P-1')

    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('failing-backend-plugin')
    expect(get(installedPlugins).get('failing-backend-plugin')).toMatchObject({ state: 'error', error: 'backend failed' })
  })

  it('does not synthesize backend command handlers from legacy manifest contributions', async () => {
    const manifest = makeManifest({ frontend: null, backend: 'backend.js' })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(executePluginCommand('backend-plugin', 'echo', { message: 'hello' })).resolves.toBe(false)

    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(pluginInvokeMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')?.state).toBe('active')
  })

  it('deactivates backend-only plugins back to installed state', async () => {
    const manifest = makeManifest({
      frontend: null,
      backend: 'backend.js',
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

  it('activates defineFrontendPlugin package entries through plugin:// assets and runtime registries', async () => {
    const LazyView = vi.fn() as never
    const commandHandler = vi.fn(async () => ({ ok: true }))
    const capturedApis: FrontendOpenForgeAPI[] = []
    const backendStateDuringActivation: string[] = []
    const activateFrontend = vi.fn((openforge, context) => {
      capturedApis.push(openforge)
      backendStateDuringActivation.push(openforge.backend.state)
      context.subscriptions.add(openforge.views.register({
        id: 'prs',
        title: 'Pull Requests',
        icon: 'git-pull-request',
        placement: 'rail',
        order: 25,
        component: () => Promise.resolve({ default: LazyView }),
      }))
      context.subscriptions.add(openforge.taskPane.registerTab({
        id: 'activity',
        title: 'Activity',
        component: LazyView,
      }))
      context.subscriptions.add(openforge.settings.registerSection({
        id: 'prefs',
        title: 'Preferences',
        component: LazyView,
      }))
      context.subscriptions.add(openforge.commands.register({
        id: 'refresh',
        title: 'Refresh',
        handler: commandHandler,
      }))
    })
    const frontendPlugin = defineFrontendPlugin({ activate: activateFrontend })
    const manifest = makeManifest({
      id: 'runtime-plugin',
      frontend: './dist/frontend.js',
      backend: './dist/backend.js',
    })

    installedPlugins.set(new Map([['runtime-plugin', {
      manifest,
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'runtime-plugin',
        apiVersion: 1,
        displayName: 'Runtime Plugin',
        description: 'Runtime plugin',
        frontend: './dist/frontend.js',
      },
    }]]))
    enabledPluginIds.set(new Set(['runtime-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'runtime-plugin', module: frontendPlugin })

    await expect(activatePlugin('runtime-plugin')).resolves.toBe(true)

    expect(loadPluginFrontendMock).toHaveBeenCalledWith('runtime-plugin', 'plugin://runtime-plugin/dist/frontend.js')
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateFrontend).toHaveBeenCalledOnce()
    expect(get(runtimeContributionSources).get('runtime-plugin')?.views).toMatchObject([
      { id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail', order: 25 },
    ])
    expect(getRegisteredComponent('plugin:runtime-plugin:prs')).toBeDefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'runtime-plugin:activity')).toBeDefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'runtime-plugin:prefs')).toBeDefined()
    await expect(executePluginCommand('runtime-plugin', 'refresh', { source: 'test' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'test' })

    const firstProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-1', taskId: 'T-1' })
    const secondProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-1', taskId: 'T-2' })
    expect(firstProps.api).toBe(secondProps.api)
    expect(firstProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-1' })
    expect(secondProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-2' })
    expect(secondProps.api.context.getSnapshot()).toEqual({ pluginId: 'runtime-plugin', projectId: null })

    await firstProps.api.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
    expect(setPluginStorageMock).toHaveBeenCalledWith('runtime-plugin', 'task', 'T-1', 'reviewState', { viewedFiles: ['README.md'] })
    getPluginStorageMock.mockResolvedValueOnce({ owner: 'acme', name: 'app' })
    await expect(firstProps.api.storage.project('P-1').get('repo')).resolves.toEqual({ owner: 'acme', name: 'app' })
    expect(getPluginStorageMock).toHaveBeenCalledWith('runtime-plugin', 'project', 'P-1', 'repo')

    const readmeContent = { type: 'text' as const, content: 'readme', mimeType: null, size: 6 }
    fsReadFileMock.mockResolvedValueOnce(readmeContent)
    await expect(firstProps.api.fs.readFile({ projectId: 'P-1', path: 'README.md' })).resolves.toEqual(readmeContent)
    await firstProps.api.system.openUrl('https://example.com/plugin')
    await firstProps.api.system.writeClipboardText('Reviewer brief')
    await firstProps.api.config.set('theme', { mode: 'dark' })
    await firstProps.api.projectConfig.set('repo', { owner: 'acme', name: 'app' }, 'P-1')
    await firstProps.api.backend.whenReady()
    await expect(firstProps.api.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toBeUndefined()

    expect(backendStateDuringActivation).toEqual(['starting'])
    expect(capturedApis[0].backend.state).toBe('ready')
    expect(fsReadFileMock).toHaveBeenCalledWith('P-1', 'README.md')
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/plugin')
    expect(writeClipboardTextMock).toHaveBeenCalledWith('Reviewer brief')
    expect(setConfigMock).toHaveBeenCalledWith('theme', '{"mode":"dark"}')
    expect(setProjectConfigMock).toHaveBeenCalledWith('P-1', 'repo', '{"owner":"acme","name":"app"}')
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('runtime-plugin')
    expect(pluginInvokeMock).toHaveBeenCalledWith('runtime-plugin', 'syncProject', { projectId: 'P-1' })

    const otherSlotProps = getPluginRenderProps('runtime-plugin', { projectId: 'P-2', taskId: 'T-99' })
    expect(firstProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-1', taskId: 'T-1' })
    expect(otherSlotProps.context).toEqual({ pluginId: 'runtime-plugin', projectId: 'P-2', taskId: 'T-99' })
    expect(firstProps.api.context.getSnapshot()).toEqual({ pluginId: 'runtime-plugin', projectId: null })
  })

  it('returns capability-specific unavailable APIs for render props before frontend activation', async () => {
    const props = getPluginRenderProps('missing-plugin', { projectId: 'P-1', taskId: 'T-1' })

    expect(props.context).toEqual({ pluginId: 'missing-plugin', projectId: 'P-1', taskId: 'T-1' })
    await expect(props.api.tasks.create({ initialPrompt: 'Scheduled prompt', projectId: 'P-1' })).rejects.toThrow(
      'OpenForge frontend runtime API is unavailable for plugin missing-plugin: tasks.create'
    )
    await expect(props.api.notifications.notify({ title: 'Ready' })).rejects.toThrow(
      'OpenForge frontend runtime API is unavailable for plugin missing-plugin: notifications.notify'
    )
    await expect(props.api.system.writeClipboardText('Reviewer brief')).rejects.toThrow(
      'OpenForge frontend runtime API is unavailable for plugin missing-plugin: system.writeClipboardText'
    )
    await props.api.system.openUrl('https://example.com/plugin')
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/plugin')
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

  it('activates runtime implementations for supported frontend contribution types', async () => {
    const viewComponent = vi.fn() as never
    const tabComponent = vi.fn() as never
    const settingsComponent = vi.fn() as never
    const commandHandler = vi.fn(async () => undefined)
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({ id: 'main', title: 'Main', icon: 'sparkles', placement: 'rail', component: viewComponent }))
        context.subscriptions.add(openforge.taskPane.registerTab({ id: 'activity', title: 'Activity', component: tabComponent }))
        context.subscriptions.add(openforge.settings.registerSection({ id: 'preferences', title: 'Preferences', component: settingsComponent }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: commandHandler }))
      },
    })

    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)

    expect(get(runtimeContributionSources).get('test-plugin')).toMatchObject({
      views: [{ id: 'main', title: 'Main' }],
      taskPaneTabs: [{ id: 'activity', title: 'Activity' }],
      settingsSections: [{ id: 'preferences', title: 'Preferences' }],
      commands: [{ id: 'open-demo', title: 'Open demo' }],
    })
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBe(viewComponent)
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBe(tabComponent)
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBe(settingsComponent)

    await expect(executePluginCommand('test-plugin', 'open-demo', { source: 'shortcut' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'shortcut' })

    await deactivatePluginById('test-plugin')

    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'test-plugin:preferences')).toBeUndefined()
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

  it('rolls back applied runtime contributions and stops started services when background startup fails', async () => {
    const viewComponent = vi.fn() as never
    const tabComponent = vi.fn() as never
    const commandHandler = vi.fn(async () => undefined)
    const firstStart = vi.fn(async () => undefined)
    const firstStop = vi.fn(async () => undefined)
    const failingStart = vi.fn(async () => {
      throw new Error('service failed')
    })
    const secondStop = vi.fn(async () => undefined)
    const snapshot = {
      pluginId: 'test-plugin',
      projectId: null,
      views: [{
        id: 'main',
        qualifiedId: 'test-plugin.main',
        pluginId: 'test-plugin',
        projectId: null,
        title: 'Main',
        icon: 'sparkles',
        placement: 'rail',
        component: viewComponent,
      }],
      taskPaneTabs: [{
        id: 'activity',
        qualifiedId: 'test-plugin.activity',
        pluginId: 'test-plugin',
        projectId: null,
        title: 'Activity',
        component: tabComponent,
      }],
      taskUISections: [],
      settingsSections: [],
      commands: [{
        id: 'open-demo',
        qualifiedId: 'test-plugin.open-demo',
        pluginId: 'test-plugin',
        projectId: null,
        title: 'Open Demo',
        handler: commandHandler,
      }],
      eventListeners: [],
      backendMethods: [],
      backgroundServices: [
        {
          id: 'poller',
          qualifiedId: 'test-plugin.poller',
          pluginId: 'test-plugin',
          projectId: null,
          scope: 'project',
          start: firstStart,
          stop: firstStop,
          started: false,
        },
        {
          id: 'failing-poller',
          qualifiedId: 'test-plugin.failing-poller',
          pluginId: 'test-plugin',
          projectId: null,
          scope: 'project',
          start: failingStart,
          stop: secondStop,
          started: false,
        },
      ],
      injectionPoints: [],
      taskStartPrefixProviders: [],
    } satisfies RuntimeContributionSnapshot

    await expect(applyRuntimeSnapshotContributions('test-plugin', snapshot)).rejects.toThrow('service failed')

    expect(firstStart).toHaveBeenCalledTimes(1)
    expect(failingStart).toHaveBeenCalledTimes(1)
    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(secondStop).not.toHaveBeenCalled()
    expect(get(runtimeContributionSources).get('test-plugin')).toBeUndefined()
    expect(getRegisteredComponent('plugin:test-plugin:main')).toBeUndefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    expect(getPluginCommandHandler('test-plugin', 'open-demo')).toBeUndefined()
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

  it('uninstallPlugin clears host event subscriptions for active runtime plugins', async () => {
    const manifest = makeManifest()
    const handler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.events.onGlobal('openforge.selection-changed', handler))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    uninstallPluginIpcMock.mockResolvedValue(undefined)

    await activatePlugin('test-plugin')

    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-123' })
    expect(handler).toHaveBeenCalledTimes(1)

    await uninstallPlugin('test-plugin')
    emitPluginHostEvent('selection-changed', { selectedTaskId: 'T-456' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('uninstallPlugin tears down runtime contributions', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    const commandHandler = vi.fn(async () => undefined)
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.taskPane.registerTab({ id: 'activity', title: 'Activity', component: vi.fn() as never }))
        context.subscriptions.add(openforge.commands.register({ id: 'open-demo', title: 'Open demo', handler: commandHandler }))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })

    await expect(activatePlugin('test-plugin')).resolves.toBe(true)
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeDefined()

    await uninstallPlugin('test-plugin')

    expect(getRegisteredRenderableComponent('taskPaneTabs', 'test-plugin:activity')).toBeUndefined()
    await expect(executePluginCommand('test-plugin', 'open-demo')).resolves.toBe(false)
  })

  it('activatePlugin returns false for plugin not in store', async () => {
    const result = await activatePlugin('nonexistent-plugin')
    expect(result).toBe(false)
    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
  })

  it('uninstallPlugin deactivates active plugin first', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    deactivatePluginLoaderMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(true)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'active', error: null }]]))

    await uninstallPlugin('test-plugin')

    expect(deactivatePluginLoaderMock).toHaveBeenCalledWith('test-plugin')
    expect(uninstallPluginIpcMock).toHaveBeenCalledWith('test-plugin')
    // deactivate must happen before uninstall IPC
    const deactivateOrder = deactivatePluginLoaderMock.mock.invocationCallOrder[0]
    const uninstallOrder = uninstallPluginIpcMock.mock.invocationCallOrder[0]
    expect(deactivateOrder).toBeLessThan(uninstallOrder)
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

  it('reloadPluginForProject deactivates the backend before refreshing installed artifacts', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', frontend: null, backend: './dist/backend.js' })
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
      backendEntry: './dist/backend.js',
      sourceKind: 'local',
      sourceSpec: '/plugins/reload-plugin',
    })
    getEnabledPluginsMock.mockResolvedValue([{
      ...makeNormalized('reload-plugin'),
      frontendEntry: null,
      backendEntry: './dist/backend.js',
    }])

    await expect(reloadPluginForProject('project-1', 'reload-plugin')).resolves.toBe(true)

    expect(pluginBackendDeactivateMock).toHaveBeenCalledWith('reload-plugin')
    expect(pluginBackendDeactivateMock.mock.invocationCallOrder[0]).toBeLessThan(getPluginIpcMock.mock.invocationCallOrder[0])
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('reload-plugin')
  })

  it('reloadPluginForProject releases live browser resources even when backend deactivation fails', async () => {
    const manifest = makeManifest({ id: 'reload-plugin', backend: './dist/backend.js' })
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

  it('initializePluginRuntime installs builtin package metadata with built frontend entries', async () => {
    installPluginMock.mockResolvedValue(undefined)

    await initializePluginRuntime()

    expect(installPluginMock).toHaveBeenCalled()
    expect(installPluginMock.mock.calls.every(([row]) => row.isBuiltin === true)).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.sourceKind === 'builtin')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.frontendEntry === './dist/frontend.js')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.contributes === '{}')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => JSON.parse(row.packageMetadata).frontend === './dist/frontend.js')).toBe(true)
  })
})
