import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlugin,
  deactivatePluginLoaderMock,
  defineFrontendPlugin,
  emitPluginHostEvent,
  enabledPluginIds,
  executePluginCommand,
  get,
  getRegisteredRenderableComponent,
  installedPlugins,
  isPluginLoadedMock,
  loadPluginFrontendMock,
  makeManifest,
  resetPluginRegistryTestState,
  uninstallPlugin,
  uninstallPluginIpcMock,
} from './pluginRegistryTestSupport'
import { publishTaskInvalidation } from './pluginTaskInvalidations'

describe('pluginRegistry uninstall teardown', () => {
  beforeEach(resetPluginRegistryTestState)

  it('uninstallPlugin removes from store', async () => {
    uninstallPluginIpcMock.mockResolvedValue(undefined)
    isPluginLoadedMock.mockReturnValue(false)
    installedPlugins.set(new Map([['test-plugin', { manifest: makeManifest(), state: 'installed', error: null }]]))
    await uninstallPlugin('test-plugin')
    expect(uninstallPluginIpcMock).toHaveBeenCalledWith('test-plugin')
    expect(get(installedPlugins).has('test-plugin')).toBe(false)
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

  it('uninstallPlugin stops Task invalidation delivery for active runtime plugins', async () => {
    const manifest = makeManifest()
    const handler = vi.fn()
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.tasks.onDidChange('P-1', handler))
      },
    })
    installedPlugins.set(new Map([['test-plugin', { manifest, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['test-plugin']))
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'test-plugin', module: frontendPlugin })
    uninstallPluginIpcMock.mockResolvedValue(undefined)

    await activatePlugin('test-plugin')
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'created' })
    expect(handler).toHaveBeenCalledOnce()

    await uninstallPlugin('test-plugin')
    publishTaskInvalidation({ projectId: 'P-1', taskId: 'T-1', reason: 'updated' })

    expect(handler).toHaveBeenCalledOnce()
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
})
