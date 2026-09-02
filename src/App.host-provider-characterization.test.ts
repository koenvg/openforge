import { render } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { setMockTasks } from './App.test-fixtures/stores'
import { createTask } from './App.test-fixtures/tasks'
import { installAppTestLifecycle } from './App.test-harness'
import type { TaskAttentionRow, TaskDetail } from './lib/types'
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

const task = createTask({
  id: 'task-1',
  projectId: project.id,
  prompt: 'Selected task',
})

describe('App core host-view characterization', () => {
  installAppTestLifecycle()

  it('renders the project dashboard host at the stable board destination with host attention metadata', async () => {
    const stores = await import('./lib/stores')
    const attentionRow = {
      project_id: project.id,
      task_id: task.id,
    } as TaskAttentionRow

    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    stores.taskAttentionRows.set([attentionRow])
    stores.taskAttentionLoaded.set(true)
    setMockTasks([task])

    render(App)

    await vi.waitFor(() => expect(vi.mocked(ProjectDashboardProviderHost)).toHaveBeenCalled())
    const props = getLatestComponentProps<{
      project: typeof project
      tasks: TaskDetail[]
      attentionRows: TaskAttentionRow[]
      attentionRowsLoaded: boolean
    }>(vi.mocked(ProjectDashboardProviderHost), 'project')

    expect(props.project).toEqual(project)
    expect(props.tasks).toEqual([task])
    expect(props.attentionRows).toEqual([attentionRow])
    expect(props.attentionRowsLoaded).toBe(true)
    expect(get(stores.currentView)).toBe('board')
  })

  it('gives the selected task provider host precedence without changing the board destination', async () => {
    const stores = await import('./lib/stores')

    stores.projects.set([project])
    stores.activeProjectId.set(project.id)
    stores.currentView.set('board')
    setMockTasks([task])
    stores.selectedTaskId.set(task.id)

    render(App)

    await vi.waitFor(() => expect(vi.mocked(TaskDetailProviderHost)).toHaveBeenCalled())
    const props = getLatestComponentProps<{ task: TaskDetail }>(vi.mocked(TaskDetailProviderHost), 'task')

    expect(props.task).toEqual(task)
    expect(vi.mocked(ProjectDashboardProviderHost)).not.toHaveBeenCalled()
    expect(get(stores.currentView)).toBe('board')
  })
})
