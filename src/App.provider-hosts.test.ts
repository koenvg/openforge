import { render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { setMockTasks } from './App.test-fixtures/stores'
import { createTask } from './App.test-fixtures/tasks'
import { installAppTestLifecycle } from './App.test-harness'
import type { TaskDetail } from './lib/types'
import App from './App.svelte'
import ProjectDashboardProviderHost from './components/focus-board/ProjectDashboardProviderHost.svelte'
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

    const props = getLatestComponentProps<{ projectId: string | null; tasks: TaskDetail[] }>(
      vi.mocked(ProjectDashboardProviderHost),
      'projectId',
    )
    expect(props.projectId).toBe(project.id)
    expect(props.tasks).toEqual([task])
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

    const props = getLatestComponentProps<{ task: TaskDetail }>(
      vi.mocked(TaskDetailProviderHost),
      'task',
    )
    expect(props.task).toEqual(task)
  })
})
