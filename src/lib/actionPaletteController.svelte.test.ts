import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTask } from '../App.test-fixtures/tasks'

import { useActionPaletteController } from './actionPaletteController.svelte'
import { COMPLETE_TASK_CONFIRM_MESSAGE, DELETE_BACKLOG_TASK_CONFIRM_MESSAGE } from './completeTask'
import { activeProjectId } from './stores'

const selectedTask = createTask({ id: 'T-1', projectId: 'proj-1', status: 'doing' })

const laterSelectedTask = {
  ...selectedTask,
  id: 'T-2',
}

describe('useActionPaletteController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeProjectId.set('proj-1')
  })

  it('delegates built-in palette actions to UI callbacks and task actions', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const showNewTask = vi.fn()
    const triggerGithubSync = vi.fn(async () => undefined)
    const controller = useActionPaletteController({
      getSelectedTask: () => selectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask,
      showProjectSwitcher: vi.fn(),
      triggerGithubSync,
    })

    controller.openActionPalette()
    await controller.executeAction('new-task')
    controller.openActionPalette()
    await controller.executeAction('refresh-github')

    expect(showNewTask).toHaveBeenCalledOnce()
    expect(triggerGithubSync).toHaveBeenCalledOnce()
  })

  it('delegates the selected pull request merge method', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => selectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    controller.openActionPalette()
    await controller.executeAction('merge-pr:squash', 'squash')

    expect(taskActions.mergeReadyPullRequest).toHaveBeenCalledWith(selectedTask, 'squash')
  })

  it.each([
    {
      action: 'Complete',
      actionId: 'complete-task',
      task: selectedTask,
      message: COMPLETE_TASK_CONFIRM_MESSAGE,
    },
    {
      action: 'Delete',
      actionId: 'delete-task',
      task: { ...selectedTask, status: 'backlog' as const },
      message: DELETE_BACKLOG_TASK_CONFIRM_MESSAGE,
    },
  ])('uses the $action confirmation copy before running the terminal Task action from the palette', async ({ actionId, task, message }) => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => task,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    controller.openActionPalette()
    await controller.executeAction(actionId)

    expect(confirmSpy).toHaveBeenCalledWith(message)
    expect(taskActions.deleteTaskAndReload).toHaveBeenCalledWith(task.id)
    confirmSpy.mockRestore()
  })

  it('does not complete the task when the confirmation is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => selectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    controller.openActionPalette()
    await controller.executeAction('complete-task')

    expect(confirmSpy).toHaveBeenCalled()
    expect(taskActions.deleteTaskAndReload).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('delegates enqueue-pr to the task action runner with the captured task', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => selectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    controller.openActionPalette()
    await controller.executeAction('enqueue-pr')

    expect(taskActions.enqueueReadyPullRequest).toHaveBeenCalledWith(selectedTask)
  })

  it('delegates Set aside and Move task back in focus to the task action runner with the captured task', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
      enqueueReadyPullRequest: vi.fn(async () => undefined),
      setTaskOutOfFocus: vi.fn(async () => undefined),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => selectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    controller.openActionPalette()
    await controller.executeAction('set-aside-task')
    controller.openActionPalette()
    await controller.executeAction('return-to-board')

    expect(taskActions.setTaskOutOfFocus).toHaveBeenNthCalledWith(1, selectedTask.id, true)
    expect(taskActions.setTaskOutOfFocus).toHaveBeenNthCalledWith(2, selectedTask.id, false)
  })

  it('runs the task-bound app command captured when the palette opened', async () => {
    let currentSelectedTask: typeof selectedTask | null = selectedTask
    let currentRunner: (() => Promise<void>) | null = vi.fn(async () => undefined)
    const capturedRunner = currentRunner
    const runApp = {
      capture: vi.fn(() => currentRunner),
    }
    const controller = useActionPaletteController({
      getSelectedTask: () => currentSelectedTask,
      taskActions: {
        handleRunAction: vi.fn(async () => undefined),
        deleteTaskAndReload: vi.fn(async () => undefined),
        mergeReadyPullRequest: vi.fn(async () => undefined),
        enqueueReadyPullRequest: vi.fn(async () => undefined),
        setTaskOutOfFocus: vi.fn(async () => undefined),
      },
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
      runApp,
    })

    await controller.openActionPalette()
    expect(controller.actionPaletteCanRunApp).toBe(true)
    expect(runApp.capture).toHaveBeenCalledWith(selectedTask)

    currentSelectedTask = laterSelectedTask
    currentRunner = null
    await controller.executeAction('run-app')

    expect(capturedRunner).toHaveBeenCalledOnce()
    expect(controller.showActionPalette).toBe(false)
  })
})
