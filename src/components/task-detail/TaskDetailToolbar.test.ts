import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  mockOnRunAction,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'
import { INITIAL_TASK_RUN_APP_STATE } from './taskRunAppController'

describe('TaskDetailToolbar', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('owns task identity, back navigation, and start action rendering', async () => {
    const TaskDetailToolbar = (await import('./TaskDetailToolbar.svelte')).default
    const onBack = vi.fn()
    render(TaskDetailToolbar, {
      props: {
        task: baseTask,
        workspacePath: null,
        activeView: 'agent',
        tabs: [],
        panelHidden: false,
        runAppState: INITIAL_TASK_RUN_APP_STATE,
        onRunAction: mockOnRunAction,
        onBack,
        onSelectView: vi.fn(),
        onRunApp: vi.fn(),
        onTaskUpdated: vi.fn(),
      },
    })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Implement auth middleware')
    await fireEvent.click(screen.getByRole('button', { name: 'Back to task board' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Start Task' }))

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '' })
  })

  it('owns task-keyed inspector visibility persistence', async () => {
    const TaskDetailToolbar = (await import('./TaskDetailToolbar.svelte')).default
    render(TaskDetailToolbar, {
      props: {
        task: baseTask,
        workspacePath: '/tmp/worktree',
        activeView: 'agent',
        tabs: [],
        panelHidden: false,
        runAppState: INITIAL_TASK_RUN_APP_STATE,
        onRunAction: mockOnRunAction,
        onBack: vi.fn(),
        onSelectView: vi.fn(),
        onRunApp: vi.fn(),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

    await waitFor(() => {
      expect(localStorage.getItem('task-info-panel-hidden:T-42')).toBe('1')
      expect(screen.getByRole('button', { name: 'Show task info panel' })).toBeTruthy()
    })
  })

  it('opens task actions with keyboard focus and restores the trigger on Escape', async () => {
    const TaskDetailToolbar = (await import('./TaskDetailToolbar.svelte')).default
    render(TaskDetailToolbar, {
      props: {
        task: { ...baseTask, status: 'doing' },
        workspacePath: '/tmp/worktree',
        activeView: 'agent',
        tabs: [],
        panelHidden: false,
        runAppState: INITIAL_TASK_RUN_APP_STATE,
        onRunAction: mockOnRunAction,
        onBack: vi.fn(),
        onSelectView: vi.fn(),
        onRunApp: vi.fn(),
      },
    })

    const trigger = screen.getByRole('button', { name: 'More task actions' })
    trigger.focus()
    await fireEvent.click(trigger)
    const menuItem = await screen.findByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(menuItem))

    await fireEvent.keyDown(menuItem, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps title editing accessible and supports cancel, Enter, and blur saves', async () => {
    const TaskDetailToolbar = (await import('./TaskDetailToolbar.svelte')).default
    const { updateTaskTitle } = await import('../../lib/ipc')
    const onTaskUpdated = vi.fn()
    render(TaskDetailToolbar, {
      props: {
        task: baseTask,
        workspacePath: null,
        activeView: 'agent',
        tabs: [],
        runAppState: INITIAL_TASK_RUN_APP_STATE,
        onRunAction: mockOnRunAction,
        onBack: vi.fn(),
        onSelectView: vi.fn(),
        onRunApp: vi.fn(),
        onTaskUpdated,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    let input = screen.getByRole('textbox', { name: 'Task title' })
    expect(input).toHaveProperty('value', 'Implement auth middleware')
    await fireEvent.input(input, { target: { value: 'Discard this title' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    expect(updateTaskTitle).not.toHaveBeenCalled()

    for (const action of ['Enter', 'blur']) {
      await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
      input = screen.getByRole('textbox', { name: 'Task title' })
      await fireEvent.input(input, { target: { value: `Saved by ${action}` } })
      if (action === 'Enter') await fireEvent.keyDown(input, { key: 'Enter' })
      else await fireEvent.blur(input)
      await waitFor(() => expect(updateTaskTitle).toHaveBeenLastCalledWith('T-42', `Saved by ${action}`))
      expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    }
    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledTimes(2))
    expect(updateTaskTitle).toHaveBeenCalledTimes(2)
  })
})
