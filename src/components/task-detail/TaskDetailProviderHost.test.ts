import { render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from '../../App.test-fixtures/component-props'
import { createTask } from '../../App.test-fixtures/tasks'
import type { TaskDetail } from '../../lib/types'
import TaskDetailProviderHost from './TaskDetailProviderHost.svelte'
import TaskDetailView from './TaskDetailView.svelte'

vi.mock('./TaskDetailView.svelte', () => ({ default: vi.fn() }))

const task = createTask({ id: 'task-1', projectId: 'project-1' })

function createProps(selectedTask: TaskDetail = task) {
  return {
    task: selectedTask,
    onRunAction: vi.fn(),
    onEdit: vi.fn(),
    onOpenTask: vi.fn(),
    onTaskUpdated: vi.fn(),
    onProjectAttentionChanged: vi.fn(),
    onRunAppRegistrationChange: vi.fn(),
  }
}

describe('TaskDetailProviderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders core task detail with host-owned task actions', () => {
    const hostProps = createProps()

    render(TaskDetailProviderHost, { props: hostProps })

    const props = getLatestComponentProps<{
      task: TaskDetail
      onRunAction: typeof hostProps.onRunAction
      onEdit: typeof hostProps.onEdit
      onOpenTask: typeof hostProps.onOpenTask
    }>(vi.mocked(TaskDetailView), 'task')

    expect(props.task).toEqual(task)
    expect(props.onRunAction).toBe(hostProps.onRunAction)
    expect(props.onEdit).toBe(hostProps.onEdit)
    expect(props.onOpenTask).toBe(hostProps.onOpenTask)
  })

  it('keeps one core task-detail mount while logical task context changes', async () => {
    const rendered = render(TaskDetailProviderHost, { props: createProps() })

    expect(vi.mocked(TaskDetailView)).toHaveBeenCalledTimes(1)

    const nextTask = createTask({ id: 'task-2', projectId: 'project-1' })
    await rendered.rerender(createProps(nextTask))

    expect(vi.mocked(TaskDetailView)).toHaveBeenCalledTimes(1)
    const props = getLatestComponentProps<{ task: TaskDetail }>(vi.mocked(TaskDetailView), 'task')
    expect(props.task).toEqual(nextTask)
  })
})
