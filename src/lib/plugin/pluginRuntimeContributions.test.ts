import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearComponentRegistry, getRegisteredRenderableComponent } from './componentRegistry'
import { applyRuntimeSnapshotContributions, clearPluginRuntimeContributions } from './pluginRuntimeContributions'
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
})
