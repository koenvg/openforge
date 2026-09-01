import { vi } from 'vitest'

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
  getEnabledAppPluginsMock,
  setAppPluginEnabledMock,
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
  fsWriteFileMock,
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
  getEnabledAppPluginsMock: vi.fn(),
  setAppPluginEnabledMock: vi.fn(),
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
  fsWriteFileMock: vi.fn(),
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
  getEnabledAppPlugins: getEnabledAppPluginsMock,
  setAppPluginEnabled: setAppPluginEnabledMock,
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
  fsWriteFile: fsWriteFileMock,
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
  listenPluginDesktopEvent: listenDesktopEventMock,
}))

vi.mock('./builtinPluginModules', () => ({
  getBuiltinPluginModule: getBuiltinPluginModuleMock,
}))

import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PluginManifest } from './types'
import type { NormalizedPluginRow } from '../ipc'
import type { RuntimeContributionSnapshot } from './runtimeContributionRegistry'

const { defineFrontendPlugin } = await import('@openforge-app/plugin-sdk/frontend')
const { get } = await import('svelte/store')
const {
  activatePlugin,
  deactivatePluginById,
  disablePluginForApp,
  disablePluginForProject,
  emitPluginHostEvent,
  enablePluginForApp,
  enablePluginForProject,
  executePluginCommand,
  getPluginRenderProps,
  initializePluginRuntime,
  installFromLocal,
  installPluginFromGit,
  installPluginFromManifest,
  installPluginFromNpm,
  loadEnabledForApp: registryLoadEnabledForApp,
  loadEnabledForProject: registryLoadEnabledForProject,
  reloadInstalledPluginMetadata,
  reloadLocalPluginFromDisk,
  reloadPluginForProject,
  uninstallPlugin,
  updateAppPluginContexts,
} = await import('./pluginRegistry')
const { appEnabledPluginIds, installedPlugins, enabledPluginIds, projectEnabledPluginIds, runtimeContributionSources } = await import('./pluginStore')
const { _resetProjectPluginReconciliationForTests } = await import('./pluginInstallReconciliation')
const {
  _resetPluginActivationLifecycleForTests,
  invokeFrontendAgentCommand,
  listFrontendAgentCommands,
} = await import('./pluginActivationLifecycle')
const {
  clearComponentRegistry,
  getRegisteredComponent,
  getRegisteredRenderableComponent,
} = await import('./componentRegistry')
const {
  applyRuntimeSnapshotContributions,
  getPluginCommandHandler,
} = await import('./pluginRuntimeContributions')

const { _resetPluginTaskInvalidationsForTests } = await import('./pluginTaskInvalidations')
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

export function resetPluginRegistryTestState(): void {
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
  getEnabledPluginsMock.mockResolvedValue([])
  getEnabledAppPluginsMock.mockReset()
  getEnabledAppPluginsMock.mockResolvedValue([])
  setAppPluginEnabledMock.mockReset()
  setAppPluginEnabledMock.mockResolvedValue(undefined)
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
  fsWriteFileMock.mockReset()
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
  _resetPluginTaskInvalidationsForTests()
  _resetProjectPluginReconciliationForTests()
  installedPlugins.set(new Map())
  appEnabledPluginIds.set(new Set())
  projectEnabledPluginIds.set(new Set())
  enabledPluginIds.set(new Set())
  runtimeContributionSources.set(new Map())
  clearComponentRegistry()
}


export {
  activatePlugin,
  activatePluginLoaderMock,
  appEnabledPluginIds,
  applyRuntimeSnapshotContributions,
  clearLoadedPluginMock,
  deactivatePluginById,
  deactivatePluginLoaderMock,
  disablePluginForApp,
  defineFrontendPlugin,
  deletePluginStorageMock,
  desktopEventHandlers,
  disablePluginForProject,
  emitPluginHostEvent,
  enablePluginForApp,
  enablePluginForProject,
  enabledPluginIds,
  executePluginCommand,
  forceGithubSyncMock,
  fsReadDirMock,
  fsReadFileMock,
  fsSearchFilesMock,
  fsWriteFileMock,
  get,
  getBuiltinPluginModuleMock,
  getConfigMock,
  getEnabledAppPluginsMock,
  getEnabledPluginsMock,
  getPluginCommandHandler,
  getPluginIpcMock,
  getPluginRenderProps,
  invokeFrontendAgentCommand,
  getPluginStorageMock,
  getProjectConfigMock,
  getRegisteredComponent,
  getRegisteredRenderableComponent,
  initializePluginRuntime,
  listFrontendAgentCommands,
  installFromLocal,
  installPluginFromGit,
  installPluginFromGitIpcMock,
  installPluginFromLocalIpcMock,
  installPluginFromManifest,
  installPluginFromNpm,
  installPluginFromNpmIpcMock,
  installPluginMock,
  installedPlugins,
  isPluginLoadedMock,
  listPluginsMock,
  listenDesktopEventMock,
  loadPluginFrontendMock,
  makeManifest,
  makeNormalized,
  openUrlMock,
  pluginBackendDeactivateMock,
  pluginBackendWhenReadyMock,
  pluginInvokeMock,
  registryLoadEnabledForApp,
  registryLoadEnabledForProject,
  reloadInstalledPluginMetadata,
  reloadLocalPluginFromDisk,
  reloadPluginForProject,
  runtimeContributionSources,
  setAppPluginEnabledMock,
  setConfigMock,
  setPluginStorageMock,
  setProjectConfigMock,
  spawnShellPtyMock,
  uninstallPlugin,
  updateAppPluginContexts,
  uninstallPluginIpcMock,
  writeClipboardTextMock,
}
export type { FrontendOpenForgeAPI, RuntimeContributionSnapshot }
