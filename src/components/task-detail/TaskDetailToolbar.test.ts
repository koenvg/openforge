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
})
