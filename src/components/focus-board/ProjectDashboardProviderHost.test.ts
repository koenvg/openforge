import { render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from '../../App.test-fixtures/component-props'
import { createTask } from '../../App.test-fixtures/tasks'
import type { TaskAttentionRow, TaskDetail } from '../../lib/types'
import ProjectDashboardProviderHost from './ProjectDashboardProviderHost.svelte'
import FocusBoard from './FocusBoard.svelte'

vi.mock('./FocusBoard.svelte', () => ({ default: vi.fn() }))

const task = createTask({ id: 'task-1', projectId: 'project-1' })

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    projectName: 'Project One',
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

describe('ProjectDashboardProviderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      projectId: 'project-2',
      projectName: 'Project Two',
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
})
