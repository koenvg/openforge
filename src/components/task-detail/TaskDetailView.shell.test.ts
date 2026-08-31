import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  mockRunAppCommandInTaskTerminal,
  resetTaskDetailViewTestState,
  secondaryTask,
} from './TaskDetailView.testUtils'

const {
  TaskDetailView,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView — shell and header', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('renders the Back navigation action', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Back to task board' }).textContent).toContain('Back')
  })

  it('renders task id', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('T-42')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders task title in header', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const titles = screen.getAllByText('Implement auth middleware')
    expect(titles.length).toBeGreaterThanOrEqual(1)
  })

  it('co-locates task identity and workbench navigation in one compact toolbar', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    const toolbar = screen.getByTestId('task-workbench-toolbar')
    const navigation = await screen.findByRole('navigation', { name: 'Task workbench tabs' })
    expect(toolbar.contains(navigation)).toBe(true)

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('registers a task-bound Run app command when the existing button is available', async () => {
    const { getProjectConfig, getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getProjectConfig).mockResolvedValue('pnpm dev')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())
    const onRunAppRegistrationChange = vi.fn()

    const rendered = render(TaskDetailView, {
      props: { task: baseTask, onRunAction: mockOnRunAction, onRunAppRegistrationChange },
    })

    let capturedRegistration: { taskId: string; available: boolean; run: () => Promise<void> } | null = null
    await waitFor(() => {
      const registration = onRunAppRegistrationChange.mock.calls
        .map(([value]) => value)
        .find((value) => value?.taskId === baseTask.id && value.available)
      expect(registration).toBeDefined()
      capturedRegistration = registration
    })

    await rendered.rerender({
      task: secondaryTask,
      onRunAction: mockOnRunAction,
      onRunAppRegistrationChange,
    })
    await capturedRegistration!.run()

    expect(mockRunAppCommandInTaskTerminal).toHaveBeenCalledWith(
      baseTask.id,
      'pnpm dev',
      expect.objectContaining({ openTerminalView: expect.any(Function) }),
    )

    rendered.unmount()
    expect(onRunAppRegistrationChange).toHaveBeenLastCalledWith(null)
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('has AgentPanel child with empty state text', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('shows a Rename task button for backlog tasks', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('shows a Rename task button regardless of status', () => {
    const { unmount } = render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
    unmount()
    render(TaskDetailView, { props: { task: { ...baseTask, status: 'done' }, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('clicking Rename reveals a title input pre-filled with the current title', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement
    expect(input.value).toBe('Implement auth middleware')
  })

  it('saves the new title on Enter and refreshes', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    const { updateTaskDetail } = await import('../../lib/tasksState')
    vi.mocked(updateTaskDetail).mockClear()
    vi.mocked(updateTaskTitle).mockClear()
    const onTaskUpdated = vi.fn()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onTaskUpdated } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Renamed task' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(updateTaskTitle).toHaveBeenCalledWith('T-42', 'Renamed task')
    })
    expect(updateTaskDetail).toHaveBeenCalledWith('T-42', expect.any(Function))
    expect(onTaskUpdated).toHaveBeenCalled()
  })

  it('Escape cancels renaming without saving', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    vi.mocked(updateTaskTitle).mockClear()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Discard me' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(updateTaskTitle).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })

  it('no longer renders the terminal-style breadcrumb row', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByText('$ cd board')).toBeNull()
  })

  it('does not render the task status badge in the header', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByLabelText('Task status')).toBeNull()
  })

  it('falls back to first line of prompt when title is empty', () => {
    const taskNoTitle = { ...baseTask, title: '', prompt: 'First prompt line\nSecond line' }
    render(TaskDetailView, { props: { task: taskNoTitle, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First prompt line')
  })

  it('falls back to task id when title and prompt are empty', () => {
    const taskNoTitleNoPrompt = { ...baseTask, title: '', prompt: '' }
    render(TaskDetailView, { props: { task: taskNoTitleNoPrompt, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('T-42')
  })
})
