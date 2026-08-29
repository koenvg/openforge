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
  invokeFrontendAgentCommand,
  installedPlugins,
  listFrontendAgentCommands,
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
import { activeProjectId } from '../stores'

const RUNTIME_PLUGIN_ID = 'runtime-plugin'
const RUNTIME_PLUGIN_URL = 'plugin://runtime-plugin/dist/frontend.js'

function installRuntimePlugin(activate: Parameters<typeof defineFrontendPlugin>[0]['activate']): void {
  const manifest = makeManifest({
    id: RUNTIME_PLUGIN_ID,
    frontend: './dist/frontend.js',
    backend: './dist/backend.cjs',
  })
  const frontendPlugin = defineFrontendPlugin({ activate })

  installedPlugins.set(new Map([[RUNTIME_PLUGIN_ID, {
    manifest,
    state: 'installed',
    error: null,
    packageMetadata: {
      id: RUNTIME_PLUGIN_ID,
      apiVersion: 1,
      displayName: 'Runtime Plugin',
      description: 'Runtime plugin',
      frontend: './dist/frontend.js',
    },
  }]]))
  enabledPluginIds.set(new Set([RUNTIME_PLUGIN_ID]))
  loadPluginFrontendMock.mockResolvedValue({ pluginId: RUNTIME_PLUGIN_ID, module: frontendPlugin })
}

describe('pluginRegistry frontend runtime', () => {
  beforeEach(() => {
    resetPluginRegistryTestState()
    activeProjectId.set(null)
  })

  it('activates defineFrontendPlugin package entries through plugin:// assets', async () => {
    const activateFrontend = vi.fn(() => undefined)
    installRuntimePlugin(activateFrontend)

    await expect(activatePlugin(RUNTIME_PLUGIN_ID)).resolves.toBe(true)

    expect(loadPluginFrontendMock).toHaveBeenCalledWith(RUNTIME_PLUGIN_ID, RUNTIME_PLUGIN_URL)
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(activateFrontend).toHaveBeenCalledOnce()
  })

  it('registers frontend runtime contributions', async () => {
    const LazyView = vi.fn() as never
    const commandHandler = vi.fn(async () => ({ ok: true }))
    installRuntimePlugin((openforge, context) => {
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

    await activatePlugin(RUNTIME_PLUGIN_ID)

    expect(get(runtimeContributionSources).get(RUNTIME_PLUGIN_ID)?.views).toMatchObject([
      { id: 'prs', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail', order: 25 },
    ])
    expect(getRegisteredComponent('plugin:runtime-plugin:prs')).toBeDefined()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'runtime-plugin:activity')).toBeDefined()
    expect(getRegisteredRenderableComponent('settingsSections', 'runtime-plugin:prefs')).toBeDefined()
    await expect(executePluginCommand(RUNTIME_PLUGIN_ID, 'refresh', { source: 'test' })).resolves.toBe(true)
    expect(commandHandler).toHaveBeenCalledWith({ source: 'test' })
  })

  it('routes agent commands to a background Task without changing the visible Project', async () => {
    const commandHandler = vi.fn(async () => ({ accepted: true }))
    activeProjectId.set('P-visible')
    installRuntimePlugin((openforge, context) => {
      context.subscriptions.add(openforge.commands.register({
        id: 'open',
        title: 'Open in Task Browser',
        agent: { description: 'Open a verified browser URL.' },
        handler: commandHandler,
      }))
    })
    await activatePlugin(RUNTIME_PLUGIN_ID)

    await expect(listFrontendAgentCommands(RUNTIME_PLUGIN_ID, 'P-background')).resolves.toEqual([
      expect.objectContaining({ qualifiedId: `${RUNTIME_PLUGIN_ID}.open` }),
    ])
    const invocationContext = {
      taskId: 'T-background',
      projectId: 'P-background',
      source: 'agent-cli' as const,
    }
    await expect(invokeFrontendAgentCommand(
      RUNTIME_PLUGIN_ID,
      'P-background',
      `${RUNTIME_PLUGIN_ID}.open`,
      { url: 'http://localhost:5173/ready' },
      invocationContext,
    )).resolves.toEqual({ accepted: true })

    expect(commandHandler).toHaveBeenCalledWith(
      { url: 'http://localhost:5173/ready' },
      invocationContext,
    )
    expect(get(activeProjectId)).toBe('P-visible')
  })

  it('returns stable frontend APIs with render-specific context', async () => {
    installRuntimePlugin(() => undefined)
    await activatePlugin(RUNTIME_PLUGIN_ID)

    const firstProps = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-1' })
    const secondProps = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-2' })
    const otherSlotProps = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-2', taskId: 'T-99' })

    expect(firstProps.api).toBe(secondProps.api)
    expect(firstProps.context).toEqual({ pluginId: RUNTIME_PLUGIN_ID, projectId: 'P-1', taskId: 'T-1' })
    expect(secondProps.context).toEqual({ pluginId: RUNTIME_PLUGIN_ID, projectId: 'P-1', taskId: 'T-2' })
    expect(otherSlotProps.context).toEqual({ pluginId: RUNTIME_PLUGIN_ID, projectId: 'P-2', taskId: 'T-99' })
    expect(firstProps.api.context.getSnapshot()).toEqual({ pluginId: RUNTIME_PLUGIN_ID, projectId: null })
  })

  it('delegates task and project storage to plugin storage IPC', async () => {
    installRuntimePlugin(() => undefined)
    await activatePlugin(RUNTIME_PLUGIN_ID)
    const { api } = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-1' })

    await api.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
    expect(setPluginStorageMock).toHaveBeenCalledWith(RUNTIME_PLUGIN_ID, 'task', 'T-1', 'reviewState', { viewedFiles: ['README.md'] })

    getPluginStorageMock.mockResolvedValueOnce({ owner: 'acme', name: 'app' })
    await expect(api.storage.project('P-1').get('repo')).resolves.toEqual({ owner: 'acme', name: 'app' })
    expect(getPluginStorageMock).toHaveBeenCalledWith(RUNTIME_PLUGIN_ID, 'project', 'P-1', 'repo')
  })

  it('delegates filesystem and system APIs to host wrappers', async () => {
    installRuntimePlugin(() => undefined)
    await activatePlugin(RUNTIME_PLUGIN_ID)
    const { api } = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-1' })
    const readmeContent = { type: 'text' as const, content: 'readme', mimeType: null, size: 6 }
    fsReadFileMock.mockResolvedValueOnce(readmeContent)

    await expect(api.fs.readFile({ projectId: 'P-1', path: 'README.md' })).resolves.toEqual(readmeContent)
    await api.system.openUrl('https://example.com/plugin')
    await api.system.writeClipboardText('Reviewer brief')

    expect(fsReadFileMock).toHaveBeenCalledWith('P-1', 'README.md')
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/plugin')
    expect(writeClipboardTextMock).toHaveBeenCalledWith('Reviewer brief')
  })

  it('serializes global and project configuration writes', async () => {
    installRuntimePlugin(() => undefined)
    await activatePlugin(RUNTIME_PLUGIN_ID)
    const { api } = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-1' })

    await api.config.set('theme', { mode: 'dark' })
    await api.projectConfig.set('repo', { owner: 'acme', name: 'app' }, 'P-1')

    expect(setConfigMock).toHaveBeenCalledWith('theme', '{"mode":"dark"}')
    expect(setProjectConfigMock).toHaveBeenCalledWith('P-1', 'repo', '{"owner":"acme","name":"app"}')
  })

  it('reports backend state and delegates readiness and invocations', async () => {
    const backendStateDuringActivation: string[] = []
    installRuntimePlugin((openforge) => {
      backendStateDuringActivation.push(openforge.backend.state)
    })

    await activatePlugin(RUNTIME_PLUGIN_ID)
    const { api } = getPluginRenderProps(RUNTIME_PLUGIN_ID, { projectId: 'P-1', taskId: 'T-1' })

    expect(backendStateDuringActivation).toEqual(['starting'])
    await api.backend.whenReady()
    expect(api.backend.state).toBe('ready')
    await expect(api.backend.invoke('syncProject', { projectId: 'P-1' })).resolves.toBeUndefined()
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith(RUNTIME_PLUGIN_ID, null)
    expect(pluginInvokeMock).toHaveBeenCalledWith(RUNTIME_PLUGIN_ID, 'syncProject', { projectId: 'P-1' })
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
