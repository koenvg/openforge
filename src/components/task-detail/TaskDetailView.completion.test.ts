import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestTerminalTaskConfirmation } from '../../lib/terminalTaskConfirmation'

vi.mock('../../lib/terminalTaskConfirmation', () => ({
  requestTerminalTaskConfirmation: vi.fn(),
}))
import {
  baseTask,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  mockResetToBoard,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'
import type { Task } from './TaskDetailView.testUtils'

const {
  TaskDetailView,
  completingTasks,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView — completion', () => {
  beforeEach(() => {
    resetTaskDetailViewTestState()
    vi.mocked(requestTerminalTaskConfirmation).mockReset()
  })

  it('shows Start Task button for backlog tasks', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Start Task')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull()
  })

  it('hides all action buttons for done tasks', () => {
    const doneTask = { ...baseTask, status: 'done' }
    render(TaskDetailView, { props: { task: doneTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull()
    expect(screen.queryByText('Start Task')).toBeNull()
    expect(screen.queryByText('Go')).toBeNull()
  })

  it('Start Task calls onRunAction with empty prompt', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    fireEvent.click(screen.getByText('Start Task'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '' })
  })

  it('shows Complete without a flag for doing tasks and no Start Task', () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Complete' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete 🏁' })).toBeNull()
    expect(screen.queryByText('Move to Done')).toBeNull()
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('completes a doing Task by confirming, requesting completion, and navigating to the board', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(true)
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: /Complete/ }))
    await vi.waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('T-42')
    })
    expect(mockResetToBoard).toHaveBeenCalled()
  })

  it('disables the Complete button and shows pending feedback while the task is completing', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(true)
    completingTasks.set(new Set(['T-42']))
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })

    const button = screen.getByRole('button', { name: /Completing/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await fireEvent.click(button)
    expect(requestTerminalTaskConfirmation).not.toHaveBeenCalled()
    expect(deleteTask).not.toHaveBeenCalled()
  })

  it('does not start a second completion while the first is still pending', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(true)
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })

    await fireEvent.click(screen.getByRole('button', { name: /Complet/ }))
    await vi.waitFor(() => expect(deleteTask).toHaveBeenCalledTimes(1))
    await fireEvent.click(screen.getByRole('button', { name: /Complet/ }))

    expect(deleteTask).toHaveBeenCalledTimes(1)
    expect(requestTerminalTaskConfirmation).toHaveBeenCalledTimes(1)
    resolveDelete()
    await vi.waitFor(() => {
      expect(mockResetToBoard).toHaveBeenCalled()
    })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
  })

  it('does not complete the task when the confirmation is cancelled', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(false)
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: /Complete/ }))
    expect(deleteTask).not.toHaveBeenCalled()
    expect(mockResetToBoard).not.toHaveBeenCalled()
  })
})
