import { render, screen, fireEvent } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { TaskDetail } from '../../lib/types'
import TaskInspectorPanel from './TaskInspectorPanel.svelte'

vi.mock('../../lib/stores', () => ({
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  projects: writable([]),
  tasks: writable([]),
  taskDetailsById: writable(new Map()),
  dependencyReferenceTasks: writable([]),
  activeSessions: writable(new Map()),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/tasksState', () => ({
  updateTaskDetail: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, projectId: 'project-1', name: 'bug' }),
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
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
  updateTaskSourceTicketUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const baseTask: TaskDetail = {
  id: 'T-748',
  projectId: 'project-1',
  status: 'doing',
  title: 'Fix the dashboard bug.',
  prompt: 'Fix the dashboard bug.',
  promptPreview: 'Fix the dashboard bug.',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
  createdAt: 1700000000,
  updatedAt: 1700000000,
}

describe('TaskInspectorPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const stores = await import('../../lib/stores')
    stores.ticketPrs.set(new Map())
    stores.mergingTaskIds.set(new Set())
    stores.projects.set([])
    ;(stores.tasks as unknown as { set(value: never[]): void }).set([])
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

  it('summarizes task identity, title, and status at the top of the Agent inspector', () => {
    render(TaskInspectorPanel, {
      props: {
        task: baseTask,
        allTasks: [],
      },
    })

    const inspector = screen.getByRole('complementary', { name: 'Task inspector for T-748' })
    expect(inspector.textContent).toContain('T-748')
    expect(inspector.textContent).toContain('Fix the dashboard bug.')
    expect(inspector.textContent).toContain('In Progress')
  })

  it('leads with the task itself instead of a redundant "Task" label', () => {
    render(TaskInspectorPanel, {
      props: {
        task: baseTask,
        allTasks: [],
      },
    })

    // Nothing else can appear in this panel, so a "Task" heading only costs a row and
    // reads as a collapsible section that never collapses. The title is the heading.
    expect(screen.queryByRole('heading', { name: 'Task' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Fix the dashboard bug.' })).toBeTruthy()
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
      title: 'Continue after the dashboard bug is fixed.',
      prompt: 'Continue after the dashboard bug is fixed.',
      promptPreview: 'Continue after the dashboard bug is fixed.',
      dependsOn: [baseTask.id],
    }

    render(TaskInspectorPanel, {
      props: {
        task: baseTask,
        allTasks: [baseTask, dependentTask],
        onOpenLinkedTask,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /T-900/ }))

    expect(onOpenLinkedTask).toHaveBeenCalledWith('T-900', 'project-1')
    expect(onOpenLinkedTask).toHaveBeenCalledTimes(1)
  })

  describe('renaming the task from the header', () => {
    it('offers a rename control next to the task name', () => {
      render(TaskInspectorPanel, { props: { task: baseTask, allTasks: [baseTask] } })

      expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
    })

    it('seeds the input with the title derived from the prompt when the task has none', async () => {
      render(TaskInspectorPanel, { props: { task: baseTask, allTasks: [baseTask] } })

      await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))

      const input = screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement
      expect(input.value).toBe('Fix the dashboard bug.')
    })

    it('saves the new title on Enter and reports the update', async () => {
      const { updateTaskTitle } = await import('../../lib/ipc')
      const onTaskUpdated = vi.fn()
      render(TaskInspectorPanel, { props: { task: baseTask, allTasks: [baseTask], onTaskUpdated } })

      await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
      const input = screen.getByRole('textbox', { name: 'Task title' })
      await fireEvent.input(input, { target: { value: 'Dashboard totals are wrong' } })
      await fireEvent.keyDown(input, { key: 'Enter' })

      expect(updateTaskTitle).toHaveBeenCalledWith('T-748', 'Dashboard totals are wrong')
      expect(onTaskUpdated).toHaveBeenCalled()
    })

    it('discards the edit on Escape', async () => {
      const { updateTaskTitle } = await import('../../lib/ipc')
      render(TaskInspectorPanel, { props: { task: baseTask, allTasks: [baseTask] } })

      await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
      const input = screen.getByRole('textbox', { name: 'Task title' })
      await fireEvent.input(input, { target: { value: 'Never saved' } })
      await fireEvent.keyDown(input, { key: 'Escape' })

      expect(updateTaskTitle).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    })

    it('allows renaming a task that is already running', async () => {
      const { updateTaskTitle } = await import('../../lib/ipc')
      // Unlike the prompt, a title is never injected into the agent session, so there
      // is no reason to lock it once the task leaves the backlog.
      render(TaskInspectorPanel, { props: { task: { ...baseTask, status: 'doing' }, allTasks: [baseTask] } })

      await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
      const input = screen.getByRole('textbox', { name: 'Task title' })
      await fireEvent.input(input, { target: { value: 'Renamed mid-run' } })
      await fireEvent.keyDown(input, { key: 'Enter' })

      expect(updateTaskTitle).toHaveBeenCalledWith('T-748', 'Renamed mid-run')
    })

    it('has no rename control when no task is selected', () => {
      render(TaskInspectorPanel, { props: { task: null, allTasks: [] } })

      expect(screen.queryByRole('button', { name: 'Rename task' })).toBeNull()
    })

    it('defers to the surrounding screen when allowRename is false', () => {
      // The task detail top bar already shows the title with its own pencil; two
      // identical rename controls on one screen is the thing this prop prevents.
      render(TaskInspectorPanel, { props: { task: baseTask, allTasks: [baseTask], allowRename: false } })

      expect(screen.queryByRole('button', { name: 'Rename task' })).toBeNull()
      // The title itself still shows; only the pencil goes away. It appears twice on
      // screen because a task with no title derives one from its initial prompt.
      const header = screen.getByTestId('task-inspector-panel').querySelector('header')
      expect(header?.textContent).toContain('Fix the dashboard bug.')
    })
  })
})
