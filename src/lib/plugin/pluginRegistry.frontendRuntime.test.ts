import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  activatePluginLoaderMock,
  defineFrontendPlugin,
  enabledPluginIds,
  executePluginCommand,
  fsReadFileMock,
  get,
  getPluginRenderProps,
  getPluginStorageMock,
  getRegisteredComponent,
  getRegisteredRenderableComponent,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  openUrlMock,
  pluginBackendWhenReadyMock,
  pluginInvokeMock,
  resetPluginRegistryTestState,
  runtimeContributionSources,
  setConfigMock,
  setPluginStorageMock,
  setProjectConfigMock,
  writeClipboardTextMock,
} from './pluginRegistryTestSupport'
import type { FrontendOpenForgeAPI } from './pluginRegistryTestSupport'

describe('pluginRegistry frontend runtime fallback and render props', () => {
  beforeEach(resetPluginRegistryTestState)

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
})
