import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  mockOnRunAction,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'
import { INITIAL_TASK_RUN_APP_STATE } from './taskRunAppController'
import type { TaskDetail } from '../../lib/types'
import { notifyTaskCompleted } from '../../lib/openAttentionOnSessionSubmit'

vi.mock('../../lib/openAttentionOnSessionSubmit', () => ({
  notifyTaskCompleted: vi.fn(),
}))

const OUT_OF_FOCUS_CONFIG_KEY = 'low_fire_task_ids'

async function renderToolbar(task: TaskDetail, onProjectAttentionChanged = vi.fn()) {
  const TaskDetailToolbar = (await import('./TaskDetailToolbar.svelte')).default
  return render(TaskDetailToolbar, {
    props: {
      task,
      workspacePath: null,
      activeView: 'agent',
      tabs: [],
      panelHidden: false,
      runAppState: INITIAL_TASK_RUN_APP_STATE,
      onRunAction: mockOnRunAction,
      onBack: vi.fn(),
      onSelectView: vi.fn(),
      onRunApp: vi.fn(),
      onProjectAttentionChanged,
    },
  })
}

async function openMoreActions() {
  const trigger = await screen.findByRole('button', { name: 'More task actions' })
  await fireEvent.click(trigger)
  return trigger
}

describe('TaskDetailToolbar — more actions menu', () => {
  const doingTask: TaskDetail = { ...baseTask, status: 'doing' }

  beforeEach(async () => {
    resetTaskDetailViewTestState()
    const { getProjectConfig, setProjectConfig } = await import('../../lib/ipc')
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(notifyTaskCompleted).mockClear()
  })

  it('pairs Complete with a disclosure trigger for a doing task', async () => {
    await renderToolbar(doingTask)

    expect(screen.getByRole('button', { name: 'Complete' })).toBeTruthy()
    const trigger = await screen.findByRole('button', { name: 'More task actions' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('leaves the backlog Start Task button without a disclosure trigger', async () => {
    await renderToolbar(baseTask)

    expect(screen.getByRole('button', { name: 'Start Task' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'More task actions' })).toBeNull()
  })

  it('renders the menu outside the toolbar header, which clips its own overflow', async () => {
    await renderToolbar(doingTask)

    await openMoreActions()

    const menu = screen.getByRole('menu')
    expect(document.body.contains(menu)).toBe(true)
    expect(screen.getByTestId('task-workbench-toolbar').contains(menu)).toBe(false)
  })

  it('returns focus to the public icon trigger when the menu closes with Escape', async () => {
    await renderToolbar(doingTask)
    const trigger = await openMoreActions()

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('sets an in-focus task aside from the menu', async () => {
    const onProjectAttentionChanged = vi.fn()
    const { setProjectConfig } = await import('../../lib/ipc')
    await renderToolbar(doingTask, onProjectAttentionChanged)

    const trigger = await openMoreActions()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('menuitem', { name: 'Return to Board' })).toBeNull()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Set aside' }))

    await waitFor(() => {
      expect(setProjectConfig).toHaveBeenCalledWith('project-1', OUT_OF_FOCUS_CONFIG_KEY, JSON.stringify(['T-42']))
    })
    expect(onProjectAttentionChanged).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('returns an out-of-focus task to the board from the menu', async () => {
    const { getProjectConfig, setProjectConfig } = await import('../../lib/ipc')
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['T-42']))
    await renderToolbar(doingTask)

    await openMoreActions()
    await screen.findByRole('menuitem', { name: 'Return to Board' })
    expect(screen.queryByRole('menuitem', { name: 'Set aside' })).toBeNull()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Return to Board' }))

    await waitFor(() => {
      expect(setProjectConfig).toHaveBeenCalledWith('project-1', OUT_OF_FOCUS_CONFIG_KEY, JSON.stringify([]))
    })
  })

  it('completes the task from the primary half without opening the menu', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderToolbar(doingTask)

    await fireEvent.click(screen.getByRole('button', { name: 'Complete' }))

    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('T-42')
    })
    expect(notifyTaskCompleted).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    confirmSpy.mockRestore()
  })

  it('does not complete when confirmation is cancelled', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await renderToolbar(doingTask)
      await fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
      expect(deleteTask).not.toHaveBeenCalled()
      expect(notifyTaskCompleted).not.toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('keeps secondary actions available while completion is in progress', async () => {
    const { completingTasks } = await import('../../lib/stores')
    completingTasks.set(new Set([doingTask.id]))
    try {
      await renderToolbar(doingTask)
      expect((screen.getByRole('button', { name: /Completing/ }) as HTMLButtonElement).disabled).toBe(true)
      await openMoreActions()
      expect(screen.getByRole('menuitem', { name: 'Set aside' })).toBeTruthy()
    } finally {
      completingTasks.set(new Set())
    }
  })

  it('closes an open menu when the displayed task changes', async () => {
    const view = await renderToolbar(doingTask)
    await openMoreActions()
    await view.rerender({ task: { ...doingTask, id: 'T-43' } })
    expect(screen.queryByRole('menu')).toBeNull()
    await openMoreActions()
    const { setProjectConfig } = await import('../../lib/ipc')
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Set aside' }))
    await waitFor(() => expect(setProjectConfig).toHaveBeenCalledWith(
      'project-1', OUT_OF_FOCUS_CONFIG_KEY, JSON.stringify(['T-43']),
    ))
  })
})
