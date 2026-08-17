import { render, screen, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Task, TaskLabel } from '../../lib/types'
import TaskInspectorPanel from './TaskInspectorPanel.svelte'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  tasks: writable([]),
  dependencyReferenceTasks: writable([]),
  activeSessions: writable(new Map()),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'project-1', name: 'bug' }),
  forceGithubSync: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  getPullRequests: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const baseTask: Task = {
  id: 'T-748',
  initial_prompt: 'Fix the dashboard bug.',
  status: 'doing',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: 'project-1',
  created_at: 1700000000,
  updated_at: 1700000000,
} as Task & { labels?: TaskLabel[] }

describe('TaskInspectorPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const stores = await import('../../lib/stores')
    stores.ticketPrs.set(new Map())
    stores.mergingTaskIds.set(new Set())
    stores.tasks.set([])
    stores.activeSessions.set(new Map())
  })

  it('renders a calm empty state when no task is selected', () => {
    render(TaskInspectorPanel, {
      props: {
        task: null,
        allTasks: [],
      },
    })

    expect(screen.getByText('Select a task to see details')).toBeTruthy()
    expect(screen.queryByTestId('task-info-panel')).toBeNull()
  })

  it('shows an Edit prompt pencil for backlog tasks when onEditTask is provided', async () => {
    const onEditTask = vi.fn()
    render(TaskInspectorPanel, {
      props: {
        task: { ...baseTask, status: 'backlog' },
        allTasks: [],
        onEditTask,
      },
    })

    const pencil = await screen.findByRole('button', { name: 'Edit prompt' })
    await fireEvent.click(pencil)
    expect(onEditTask).toHaveBeenCalledWith('T-748')
  })

  it('does not show an Edit prompt pencil for non-backlog tasks', () => {
    render(TaskInspectorPanel, {
      props: { task: baseTask, allTasks: [], pullRequests: [], onEditTask: vi.fn() },
    })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('exposes a full-view action for the selected focus-board task', async () => {
    const onOpenFullView = vi.fn()

    render(TaskInspectorPanel, {
      props: {
        task: baseTask,
        allTasks: [baseTask],
        onOpenFullView,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /open full view/i }))

    expect(onOpenFullView).toHaveBeenCalledOnce()
  })

  it('opens a dependent task from the focus-board side panel', async () => {
    const onOpenLinkedTask = vi.fn()
    const dependentTask = {
      ...baseTask,
      id: 'T-900',
      initial_prompt: 'Continue after the dashboard bug is fixed.',
      depends_on: [baseTask.id],
    }

    render(TaskInspectorPanel, {
      props: {
        task: baseTask,
        allTasks: [baseTask, dependentTask],
        onOpenLinkedTask,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /T-900/ }))

    expect(onOpenLinkedTask).toHaveBeenCalledWith('T-900')
    expect(onOpenLinkedTask).toHaveBeenCalledTimes(1)
  })

})
