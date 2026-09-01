import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from '../../App.test-fixtures/component-props'
import { createTask } from '../../App.test-fixtures/tasks'
import type { TaskAttentionRow, TaskDetail } from '../../lib/types'
import {
  clearComponentRegistry,
  registerRenderableContributionComponent,
} from '../../lib/plugin/componentRegistry'
import { clearProjectDashboardProviderIds, projectDashboardProviderIds } from '../../lib/plugin/projectDashboardProviders'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import ProjectDashboardPluginTestView from './ProjectDashboardPluginTestView.svelte'
import PluginSlotCrashingView from '../plugin/PluginSlotCrashingView.svelte'
import ProjectDashboardProviderHost from './ProjectDashboardProviderHost.svelte'
import FocusBoard from './FocusBoard.svelte'

vi.mock('./FocusBoard.svelte', () => ({ default: vi.fn() }))

const project = {
  id: 'project-1',
  name: 'Project One',
  path: '/test/project-one',
  created_at: 1,
  updated_at: 1,
}
const task = createTask({ id: 'task-1', projectId: 'project-1' })

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    project,
    tasks: [task],
    taskDetailsById: new Map([[task.id, task]]),
    dependencyReferenceTasks: [],
    activeSessions: new Map(),
    ticketPrs: new Map(),
    attentionRows: [{ project_id: 'project-1', task_id: task.id }] as TaskAttentionRow[],
    attentionRowsLoaded: true,
    isLoading: false,
    onOpenTask: vi.fn(),
    onEditTask: vi.fn(),
    onTaskUpdated: vi.fn(),
    onProjectAttentionChanged: vi.fn(),
    onOpenCommandSearch: vi.fn(),
    onNewTask: vi.fn(),
    onRunAction: vi.fn(),
    ...overrides,
  }
}

function selectPluginDashboard(component: unknown = ProjectDashboardPluginTestView): void {
  enabledPluginIds.set(new Set(['planning-plugin']))
  runtimeContributionSources.set(new Map([['planning-plugin', {
    pluginId: 'planning-plugin',
    viewReplacements: [{
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Planning',
      icon: 'panels-top-left',
    }],
  }]]))
  registerRenderableContributionComponent(
    'viewReplacements',
    'planning-plugin:dashboard',
    component as never,
  )
  projectDashboardProviderIds.set(new Map([[project.id, 'planning-plugin.dashboard']]))
}

describe('ProjectDashboardProviderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearComponentRegistry()
    clearProjectDashboardProviderIds()
    enabledPluginIds.set(new Set())
    installedPlugins.set(new Map())
    runtimeContributionSources.set(new Map())
  })

  it('renders the core dashboard with the complete host-owned dashboard context', () => {
    render(ProjectDashboardProviderHost, { props: createProps() })

    const props = getLatestComponentProps<{
      projectId: string | null
      tasks: TaskDetail[]
      attentionRows: TaskAttentionRow[]
      onOpenTask: (taskId: string) => void
    }>(vi.mocked(FocusBoard), 'projectId')

    expect(props.projectId).toBe('project-1')
    expect(props.tasks).toEqual([task])
    expect(props.attentionRows).toEqual([{ project_id: 'project-1', task_id: task.id }])
    expect(props.onOpenTask).toBeTypeOf('function')
  })

  it('keeps one core dashboard mount while the logical project changes', async () => {
    const rendered = render(ProjectDashboardProviderHost, { props: createProps() })

    expect(vi.mocked(FocusBoard)).toHaveBeenCalledTimes(1)

    await rendered.rerender(createProps({
      project: { ...project, id: 'project-2', name: 'Project Two' },
      tasks: [],
      taskDetailsById: new Map(),
      attentionRows: [],
    }))

    expect(vi.mocked(FocusBoard)).toHaveBeenCalledTimes(1)
    const props = getLatestComponentProps<{ projectId: string | null }>(
      vi.mocked(FocusBoard),
      'projectId',
    )
    expect(props.projectId).toBe('project-2')
  })

  it('keeps the existing empty-board loading presentation inside the provider host', () => {
    render(ProjectDashboardProviderHost, {
      props: createProps({ tasks: [], isLoading: true }),
    })

    expect(screen.getByText('Loading tasks...')).toBeTruthy()
    expect(vi.mocked(FocusBoard)).not.toHaveBeenCalled()
  })

  it('renders the selected plugin with typed project context and host callbacks', async () => {
    selectPluginDashboard()
    const onOpenTask = vi.fn()
    const onNewTask = vi.fn()
    const onOpenCommandSearch = vi.fn()

    render(ProjectDashboardProviderHost, {
      props: createProps({ onOpenTask, onNewTask, onOpenCommandSearch }),
    })

    expect((await screen.findByTestId('plugin-project-dashboard')).textContent).toContain(
      'Project One:planning-plugin:project-1:api',
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Search tasks' }))
    expect(onOpenTask).toHaveBeenCalledWith('task-1', project.id)
    expect(onNewTask).toHaveBeenCalledOnce()
    expect(onOpenCommandSearch).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing', null],
    ['loading failed', () => Promise.reject(new Error('dashboard load failed'))],
    ['rendering failed', PluginSlotCrashingView],
  ])('falls back to the core dashboard when the selected provider is %s', async (_case, component) => {
    if (component) selectPluginDashboard(component)
    else {
      enabledPluginIds.set(new Set(['planning-plugin']))
      installedPlugins.set(new Map([['planning-plugin', {
        state: 'active',
        error: null,
        manifest: {},
      } as never]]))
      runtimeContributionSources.set(new Map([['planning-plugin', {
        pluginId: 'planning-plugin',
        viewReplacements: [{
          id: 'dashboard', target: 'project.dashboard', title: 'Planning', icon: 'panels-top-left',
        }],
      }]]))
      projectDashboardProviderIds.set(new Map([[project.id, 'planning-plugin.dashboard']]))
    }

    render(ProjectDashboardProviderHost, { props: createProps() })

    await vi.waitFor(() => expect(vi.mocked(FocusBoard)).toHaveBeenCalled())
    const props = getLatestComponentProps<{ projectId: string | null; tasks: TaskDetail[] }>(
      vi.mocked(FocusBoard),
      'projectId',
    )
    expect(props.projectId).toBe(project.id)
    expect(props.tasks).toEqual([task])
    expect(get(projectDashboardProviderIds).get(project.id)).toBe('planning-plugin.dashboard')
    if (_case === 'missing') {
      expect(get(installedPlugins).get('planning-plugin')).toMatchObject({
        state: 'error',
        error: 'Dashboard provider planning-plugin.dashboard failed to load',
      })
    }
  })
})
