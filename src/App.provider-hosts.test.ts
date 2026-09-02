import { render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { setMockTasks } from './App.test-fixtures/stores'
import { createTask } from './App.test-fixtures/tasks'
import { installAppTestLifecycle } from './App.test-harness'
import type { TaskDetail } from './lib/types'
import { getProjectConfig } from './lib/ipc'
import App from './App.svelte'
import ProjectDashboardProviderHost from './components/focus-board/ProjectDashboardProviderHost.svelte'
import IconRail from './components/shell/IconRail.svelte'
import ActionPalette from './components/shell/ActionPalette.svelte'
import TaskDetailProviderHost from './components/task-detail/TaskDetailProviderHost.svelte'

vi.mock('./components/focus-board/ProjectDashboardProviderHost.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/task-detail/TaskDetailProviderHost.svelte', () => ({ default: vi.fn() }))

const project = {
  id: 'proj-1',
  name: 'Project One',
  path: '/test/project-one',
  created_at: 0,
  updated_at: 0,
}

const task = createTask({ id: 'task-1', projectId: project.id })

describe('App host-view provider routing', () => {
  installAppTestLifecycle()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes the stable dashboard destination through the project dashboard provider host', async () => {
    const stores = await import('./lib/stores')
    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    setMockTasks([task])

    render(App)

    await vi.waitFor(() => expect(vi.mocked(ProjectDashboardProviderHost)).toHaveBeenCalled())
    expect(vi.mocked(TaskDetailProviderHost)).not.toHaveBeenCalled()

    const props = getLatestComponentProps<{ project: typeof project; tasks: TaskDetail[] }>(
      vi.mocked(ProjectDashboardProviderHost),
      'project',
    )
    expect(props.project).toEqual(project)
    expect(props.tasks).toEqual([task])
  })


  it('keeps core dashboard metadata until the project override has loaded', async () => {
    let resolvePreference!: (value: string | null) => void
    vi.mocked(getProjectConfig).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreference = resolve
    }))
    const stores = await import('./lib/stores')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const dashboardProviders = await import('./lib/plugin/projectDashboardProviders')
    const componentRegistry = await import('./lib/plugin/componentRegistry')
    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    componentRegistry.registerRenderableContributionComponent(
      'viewReplacements',
      'planning-plugin:dashboard',
      vi.fn() as never,
    )
    pluginStore.installedPlugins.set(new Map([['planning-plugin', {
      state: 'active', error: null, manifest: {},
    } as never]]))
    pluginStore.enabledPluginIds.set(new Set(['planning-plugin']))
    pluginStore.runtimeContributionSources.set(new Map([['planning-plugin', {
      pluginId: 'planning-plugin',
      viewReplacements: [{
        id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left',
      }],
    }]]))
    dashboardProviders.globalProjectDashboardProviderId.set('planning-plugin.dashboard')
    dashboardProviders.globalProjectDashboardProviderLoaded.set(true)

    render(App)

    await vi.waitFor(() => expect(vi.mocked(IconRail)).toHaveBeenCalled())
    const railProps = getLatestComponentProps<{ dashboardNavItem: null }>(
      vi.mocked(IconRail),
      'dashboardNavItem',
      { latestCallOnly: true },
    )
    expect(railProps.dashboardNavItem).toBeNull()

    resolvePreference('core')
    const { get } = await import('svelte/store')
    await vi.waitFor(() => {
      expect(get(dashboardProviders.projectDashboardProviderIds).get(project.id)).toBe('core')
    })
  })

  it('uses inherited dashboard metadata while keeping task opening on the board route', async () => {
    const stores = await import('./lib/stores')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const dashboardProviders = await import('./lib/plugin/projectDashboardProviders')
    const componentRegistry = await import('./lib/plugin/componentRegistry')
    const { get } = await import('svelte/store')
    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    stores.taskDetailsById.set(new Map([[task.id, task]]))
    setMockTasks([task])
    componentRegistry.registerRenderableContributionComponent(
      'viewReplacements',
      'planning-plugin:dashboard',
      vi.fn() as never,
    )
    pluginStore.enabledPluginIds.set(new Set(['planning-plugin']))
    pluginStore.installedPlugins.set(new Map([['planning-plugin', {
      state: 'active',
      error: null,
      manifest: {},
    } as never]]))
    pluginStore.runtimeContributionSources.set(new Map([['planning-plugin', {
      pluginId: 'planning-plugin',
      viewReplacements: [{
        id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left',
      }],
    }]]))
    dashboardProviders.globalProjectDashboardProviderId.set('planning-plugin.dashboard')
    dashboardProviders.globalProjectDashboardProviderLoaded.set(true)
    dashboardProviders.projectDashboardProviderIds.set(new Map([[project.id, 'inherit']]))

    render(App)

    await vi.waitFor(() => expect(vi.mocked(IconRail)).toHaveBeenCalled())
    const railProps = getLatestComponentProps<{ dashboardNavItem: { title: string; icon: string } }>(
      vi.mocked(IconRail),
      'dashboardNavItem',
      { latestCallOnly: true },
    )
    expect(railProps.dashboardNavItem).toEqual({ title: 'Planning', icon: 'panels-top-left' })

    const dashboardProps = getLatestComponentProps<{ onOpenTask: (taskId: string) => Promise<void> }>(
      vi.mocked(ProjectDashboardProviderHost),
      'onOpenTask',
      { latestCallOnly: true },
    )
    await dashboardProps.onOpenTask(task.id)
    expect(get(stores.currentView)).toBe('board')
    expect(get(stores.selectedTaskId)).toBe(task.id)
  })

  it('keeps core dashboard navigation metadata when the configured component is unavailable', async () => {
    const stores = await import('./lib/stores')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const dashboardProviders = await import('./lib/plugin/projectDashboardProviders')
    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    pluginStore.enabledPluginIds.set(new Set(['planning-plugin']))
    pluginStore.runtimeContributionSources.set(new Map([['planning-plugin', {
      pluginId: 'planning-plugin',
      viewReplacements: [{
        id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left',
      }],
    }]]))
    dashboardProviders.projectDashboardProviderIds.set(new Map([[project.id, 'planning-plugin.dashboard']]))

    render(App)

    await vi.waitFor(() => expect(vi.mocked(IconRail)).toHaveBeenCalled())
    const railProps = getLatestComponentProps<{ dashboardNavItem: null }>(
      vi.mocked(IconRail),
      'dashboardNavItem',
      { latestCallOnly: true },
    )
    expect(railProps.dashboardNavItem).toBeNull()
  })
  it('routes a selected task through the task detail provider host before the dashboard provider', async () => {
    const stores = await import('./lib/stores')
    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    setMockTasks([task])
    stores.selectedTaskId.set(task.id)

    render(App)

    await vi.waitFor(() => expect(vi.mocked(TaskDetailProviderHost)).toHaveBeenCalled())
    expect(vi.mocked(ProjectDashboardProviderHost)).not.toHaveBeenCalled()

    const props = getLatestComponentProps<{
      task: TaskDetail
      project: typeof project
      relatedTasks: unknown[]
      onOpenTaskActions: () => void
      onRefreshTask: () => Promise<void>
    }>(
      vi.mocked(TaskDetailProviderHost),
      'task',
    )
    expect(props.task).toEqual(task)
    expect(props.project).toEqual(project)
    expect(props.relatedTasks).toEqual([])

    props.onOpenTaskActions()
    await vi.waitFor(() => expect(vi.mocked(ActionPalette)).toHaveBeenCalled())
    expect(getLatestComponentProps<{ task: TaskDetail }>(vi.mocked(ActionPalette), 'task').task).toEqual(task)
  })
})
