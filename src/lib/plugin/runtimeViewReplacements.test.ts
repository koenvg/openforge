import { describe, expect, it, vi } from 'vitest'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'
import { getRegisteredRenderableComponent } from './componentRegistry'
import { applyRuntimeSnapshotContributions, clearPluginRuntimeContributions } from './pluginRuntimeContributions'

const Dashboard = vi.fn() as never
const TaskWorkspace = vi.fn() as never
const AdditiveView = vi.fn() as never

function metadata(requires: OpenForgePackageMetadata['requires'] = ['viewReplacements']): OpenForgePackageMetadata {
  return {
    id: 'dashboard-plugin',
    apiVersion: 1,
    displayName: 'Dashboard plugin',
    description: 'Provides a project dashboard.',
    frontend: './frontend.js',
    requires,
  }
}

function makeRegistry(requires: OpenForgePackageMetadata['requires'] = ['viewReplacements']) {
  return createRuntimeContributionRegistry({
    pluginId: 'dashboard-plugin',
    projectId: 'project-1',
    packageMetadata: metadata(requires),
  })
}

describe('runtime project dashboard replacements', () => {
  it('registers a valid provider separately from an additive View with the same local id', () => {
    const registry = makeRegistry(['views', 'viewReplacements'])

    registry.getFrontendApi().views.register({
      id: 'dashboard',
      title: 'Dashboard page',
      icon: 'layout-dashboard',
      placement: 'sidebar',
      component: AdditiveView,
    })
    registry.getFrontendApi().viewReplacements.register({
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Planning',
      icon: 'panels-top-left',
      component: Dashboard,
    })

    expect(registry.getSnapshot().views).toHaveLength(1)
    expect(registry.getSnapshot().viewReplacements).toMatchObject([
      {
        id: 'dashboard',
        qualifiedId: 'dashboard-plugin.dashboard',
        target: 'project.dashboard',
        title: 'Planning',
        icon: 'panels-top-left',
      },
    ])
  })

  it('registers task detail as the second typed replacement target', () => {
    const registry = makeRegistry()
    registry.getFrontendApi().viewReplacements.register({
      id: 'task-workspace',
      target: 'task.detail',
      title: 'Task workspace',
      component: TaskWorkspace,
    })

    expect(registry.getSnapshot().views).toEqual([])
    expect(registry.getSnapshot().viewReplacements).toMatchObject([{
      id: 'task-workspace',
      qualifiedId: 'dashboard-plugin.task-workspace',
      target: 'task.detail',
      title: 'Task workspace',
    }])
  })


  it('rejects missing capability, duplicate claims, invalid metadata, and unsupported targets', () => {
    expect(() => makeRegistry([]).getFrontendApi().viewReplacements.register({
      id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left', component: Dashboard,
    })).toThrow(/viewReplacements capability/i)

    const registry = makeRegistry()
    const registration = {
      id: 'dashboard', target: 'project.dashboard' as const, title: 'Planning', icon: 'panels-top-left', component: Dashboard,
    }
    registry.getFrontendApi().viewReplacements.register(registration)
    expect(() => registry.getFrontendApi().viewReplacements.register(registration)).toThrow(/duplicate/i)
    expect(() => makeRegistry().getFrontendApi().viewReplacements.register({
      ...registration, id: 'invalid-title', title: ' ',
    })).toThrow(/title/i)
    expect(() => makeRegistry().getFrontendApi().viewReplacements.register({
      ...registration, id: 'invalid-icon', icon: '',
    })).toThrow(/icon/i)
    expect(() => makeRegistry().getFrontendApi().viewReplacements.register({
      ...registration, id: 'unsupported', target: 'settings.main' as never,
    })).toThrow(/unsupported target.*settings\.main/i)
  })

  it('rolls back earlier frontend contributions when replacement activation fails', async () => {
    const registry = makeRegistry(['views'])

    await expect(registry.activateFrontend(defineFrontendPlugin({
      activate(openforge) {
        openforge.views.register({
          id: 'page', title: 'Page', icon: 'panel-left', placement: 'rail', component: AdditiveView,
        })
        openforge.viewReplacements.register({
          id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left', component: Dashboard,
        })
      },
    }))).rejects.toThrow(/viewReplacements capability/i)

    expect(registry.getSnapshot().views).toEqual([])
    expect(registry.getSnapshot().viewReplacements).toEqual([])
  })

  it('registers the render component on activation and removes it on teardown', async () => {
    const registry = makeRegistry()
    registry.getFrontendApi().viewReplacements.register({
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Planning',
      icon: 'panels-top-left',
      component: Dashboard,
    })

    await applyRuntimeSnapshotContributions('dashboard-plugin', registry.getSnapshot())
    expect(getRegisteredRenderableComponent('viewReplacements', 'dashboard-plugin:dashboard')).toBe(Dashboard)

    clearPluginRuntimeContributions('dashboard-plugin')
    expect(getRegisteredRenderableComponent('viewReplacements', 'dashboard-plugin:dashboard')).toBeUndefined()
  })
})
