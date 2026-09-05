import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { syncFrontendContributions } from './liveFrontendContributions'

import { clearComponentRegistry, getRegisteredRenderableComponent } from './componentRegistry'
import { applyRuntimeSnapshotContributions, clearPluginRuntimeContributions, stopPluginBackgroundServices } from './pluginRuntimeContributions'
import { runtimeContributionSources } from './pluginStore'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

const DirectSection = ((_anchor: Node, _props: Record<string, unknown>) => undefined) as never
const LazySection = (() => Promise.resolve({ default: DirectSection })) as never

describe('plugin runtime task UI contributions', () => {
  beforeEach(() => {
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
    clearPluginRuntimeContributions('plugin.sections')
  })

  it('applies task UI section snapshot metadata and direct/lazy component sources, then clears them', async () => {
    const registry = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    const api = registry.getFrontendApi()
    api.taskUI.registerSection({ id: 'direct', order: 20, component: DirectSection })
    api.taskUI.registerSection({ id: 'lazy', order: 10, component: LazySection })

    await applyRuntimeSnapshotContributions('plugin.sections', registry.getSnapshot())

    expect(get(runtimeContributionSources).get('plugin.sections')?.taskUISections).toEqual([
      { id: 'direct', order: 20 },
      { id: 'lazy', order: 10 },
    ])
    expect(getRegisteredRenderableComponent('taskUISections', 'plugin.sections:direct')).toBe(DirectSection)
    expect(getRegisteredRenderableComponent('taskUISections', 'plugin.sections:lazy')).toBe(LazySection)

    clearPluginRuntimeContributions('plugin.sections')
    expect(get(runtimeContributionSources).has('plugin.sections')).toBe(false)
    expect(getRegisteredRenderableComponent('taskUISections', 'plugin.sections:direct')).toBeUndefined()
    expect(getRegisteredRenderableComponent('taskUISections', 'plugin.sections:lazy')).toBeUndefined()
  })


  it('preserves workspace availability metadata for task pane tabs', async () => {
    const registry = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    registry.getFrontendApi().taskUI.registerTab({
      id: 'files',
      title: 'Files',
      requiresWorkspace: false,
      component: DirectSection,
    })

    await applyRuntimeSnapshotContributions('plugin.sections', registry.getSnapshot())

    expect(get(runtimeContributionSources).get('plugin.sections')?.taskPaneTabs).toEqual([{
      id: 'files',
      title: 'Files',
      icon: undefined,
      order: undefined,
      requiresWorkspace: false,
    }])
  })
  it('re-applies a snapshot in a single store update without clearing the source first', async () => {
    const seed = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    seed.getFrontendApi().taskUI.registerSection({ id: 'direct', order: 20, component: DirectSection })
    await applyRuntimeSnapshotContributions('plugin.sections', seed.getSnapshot())

    const presence: boolean[] = []
    const unsubscribe = runtimeContributionSources.subscribe(map => presence.push(map.has('plugin.sections')))
    presence.length = 0

    const reapply = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    reapply.getFrontendApi().taskUI.registerSection({ id: 'direct', order: 20, component: DirectSection })
    await applyRuntimeSnapshotContributions('plugin.sections', reapply.getSnapshot())
    unsubscribe()

    // A clear-then-set flip would emit an intermediate map without the plugin, which
    // unmounts the plugin's rendered sections and causes the Settings page flash.
    expect(presence.length).toBeGreaterThan(0)
    expect(presence).not.toContain(false)
  })

  it('preserves sanitized custom SVG icons while applying runtime view snapshots', async () => {
    const registry = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    registry.getFrontendApi().views.register({
      id: 'issues',
      title: 'Issues',
      icon: {
        type: 'svg',
        svg: '<svg viewBox="0 0 24 24" onclick="alert(1)"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"/></svg>',
      },
      placement: 'rail',
      component: DirectSection,
    })

    await applyRuntimeSnapshotContributions('plugin.sections', registry.getSnapshot())

    const icon = get(runtimeContributionSources).get('plugin.sections')?.views?.[0]?.icon
    expect(icon).toMatchObject({ type: 'svg' })
    expect(icon).not.toEqual(expect.objectContaining({ svg: expect.stringContaining('onclick') }))
  })

  it('keeps background services and commands alive across frontend registration changes', async () => {
    const registry = createRuntimeContributionRegistry({ pluginId: 'plugin.sections', projectId: 'P-1' })
    const start = vi.fn(), stop = vi.fn(), command = vi.fn()
    await registry.activateBackend(defineBackendPlugin({
      activate(api, context) {
        context.subscriptions.add(api.background.register({ id: 'watcher', scope: 'project', start, stop }))
      },
    }))
    const api = registry.getFrontendApi()
    api.commands.register({ id: 'refresh', title: 'Refresh', handler: command })
    await applyRuntimeSnapshotContributions('plugin.sections', registry.getSnapshot())
    registry.observeFrontendContributions(snapshot => syncFrontendContributions('plugin.sections', snapshot))
    const source = get(runtimeContributionSources).get('plugin.sections')!
    const first = api.taskPane.registerTab({ id: 'late', title: 'First', component: DirectSection })
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'plugin.sections:late')).toBe(DirectSection)
    await first.dispose()
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'plugin.sections:late')).toBeUndefined()
    const second = api.taskPane.registerTab({ id: 'late', title: 'Second', requiresWorkspace: false, component: LazySection })
    expect(get(runtimeContributionSources).get('plugin.sections')?.taskPaneTabs).toMatchObject([{ id: 'late', title: 'Second', requiresWorkspace: false }])
    expect(getRegisteredRenderableComponent('taskPaneTabs', 'plugin.sections:late')).toBe(LazySection)
    expect(get(runtimeContributionSources).get('plugin.sections')?.commands).toBe(source.commands)
    expect(get(runtimeContributionSources).get('plugin.sections')?.backgroundServices).toBe(source.backgroundServices)
    expect(start).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
    await second.dispose()
    await stopPluginBackgroundServices('plugin.sections')
    await registry.deactivate()
    expect(stop).toHaveBeenCalledOnce()
  })
})
