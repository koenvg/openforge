import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  applyRuntimeSnapshotContributions,
  deactivatePluginById,
  defineFrontendPlugin,
  executePluginCommand,
  get,
  getPluginCommandHandler,
  getRegisteredComponent,
  getRegisteredRenderableComponent,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  resetPluginRegistryTestState,
  runtimeContributionSources,
} from './pluginRegistryTestSupport'
import type { RuntimeContributionSnapshot } from './pluginRegistryTestSupport'

describe('pluginRegistry contribution queries', () => {
  beforeEach(resetPluginRegistryTestState)

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
      viewReplacements: [],
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
      themes: [],
      injectionPoints: [],
      reviewRowActions: [],
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
})
