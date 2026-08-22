import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadEnabledForProject,
  reloadInstalledPluginMetadata,
  reloadPluginForProject,
} from '../plugin/pluginRegistry'
import { createPluginEventListeners } from './pluginEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

vi.mock('../plugin/pluginRegistry', () => ({
  loadEnabledForProject: vi.fn(async () => undefined),
  reloadInstalledPluginMetadata: vi.fn(async () => true),
  reloadPluginForProject: vi.fn(async () => true),
}))

describe('createPluginEventListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the plugin registry defaults for sidecar plugin management events', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    const defaultDeps = {
      getActiveProjectId: deps.getActiveProjectId,
    }
    await registerEventListenerGroup(createPluginEventListeners(defaultDeps), deps.listen!)

    await handlers.get('plugin-installation-changed')?.({ payload: { plugin_id: 'review-helper' } })
    await handlers.get('project-plugin-enablement-changed')?.({
      payload: { plugin_id: 'review-helper', project_id: 'P-1', enabled: true },
    })
    await handlers.get('plugin-reload-requested')?.({
      payload: { plugin_id: 'review-helper', project_id: null },
    })

    expect(reloadInstalledPluginMetadata).toHaveBeenCalledWith('review-helper')
    expect(loadEnabledForProject).toHaveBeenCalledWith('P-1')
    expect(reloadPluginForProject).toHaveBeenCalledWith('P-1', 'review-helper')
  })

  it('refreshes plugin state from sidecar plugin management events without rebuilding plugin source', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPluginEventListeners(deps), deps.listen!)

    await handlers.get('plugin-installation-changed')?.({ payload: { plugin_id: 'review-helper' } })
    await handlers.get('project-plugin-enablement-changed')?.({
      payload: { plugin_id: 'review-helper', project_id: 'P-1', enabled: true },
    })

    expect(deps.reloadInstalledPluginMetadata).toHaveBeenCalledOnce()
    expect(deps.reloadInstalledPluginMetadata).toHaveBeenCalledWith('review-helper')
    expect(deps.loadEnabledPluginsForProject).toHaveBeenCalledWith('P-1')
  })

  it('reloads an unscoped plugin request for the active project', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPluginEventListeners(deps), deps.listen!)

    await handlers.get('plugin-reload-requested')?.({
      payload: { plugin_id: 'review-helper', project_id: null },
    })

    expect(deps.reloadInstalledPluginMetadata).not.toHaveBeenCalled()
    expect(deps.reloadPluginForProject).toHaveBeenCalledWith('P-1', 'review-helper')
  })

  it('ignores project plugin enablement events for inactive projects', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    vi.mocked(deps.getActiveProjectId!).mockReturnValue('P-2')
    await registerEventListenerGroup(createPluginEventListeners(deps), deps.listen!)

    await handlers.get('project-plugin-enablement-changed')?.({
      payload: { plugin_id: 'review-helper', project_id: 'P-1', enabled: true },
    })

    expect(deps.loadEnabledPluginsForProject).not.toHaveBeenCalled()
  })

  it('reloads a scoped plugin request for the active project regardless of the requested project', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    vi.mocked(deps.getActiveProjectId!).mockReturnValue('P-2')
    await registerEventListenerGroup(createPluginEventListeners(deps), deps.listen!)

    await handlers.get('plugin-reload-requested')?.({
      payload: { plugin_id: 'review-helper', project_id: 'P-1' },
    })

    expect(deps.reloadPluginForProject).toHaveBeenCalledWith('P-2', 'review-helper')
  })
})
