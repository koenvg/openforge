import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestTerminalTaskConfirmation } from './terminalTaskConfirmation'

vi.mock('./terminalTaskConfirmation', () => ({
  requestTerminalTaskConfirmation: vi.fn(),
}))
import { createTask } from '../App.test-fixtures/tasks'

import { useActionPaletteController } from './actionPaletteController.svelte'
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
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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
      method: 'completeTaskAndReload' as const,
    },
    {
      action: 'Delete',
      actionId: 'delete-task',
      task: { ...selectedTask, status: 'backlog' as const },
      method: 'deleteTaskAndReload' as const,
    },
  ])('asks to confirm $action before running the terminal Task action from the palette', async ({ action, actionId, task, method }) => {
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(true)
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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

    expect(requestTerminalTaskConfirmation).toHaveBeenCalledWith(action, task.id)
    expect(taskActions[method]).toHaveBeenCalledWith(task.id)
    expect(taskActions[method === 'completeTaskAndReload' ? 'deleteTaskAndReload' : 'completeTaskAndReload']).not.toHaveBeenCalled()
  })

  it('does not complete the task when the confirmation is cancelled', async () => {
    vi.mocked(requestTerminalTaskConfirmation).mockResolvedValue(false)
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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

    expect(requestTerminalTaskConfirmation).toHaveBeenCalled()
    expect(taskActions.deleteTaskAndReload).not.toHaveBeenCalled()
    expect(taskActions.completeTaskAndReload).not.toHaveBeenCalled()
  })

  it('delegates enqueue-pr to the task action runner with the captured task', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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
      runActionOrThrow: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      completeTaskAndReload: vi.fn(async () => undefined),
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
        runActionOrThrow: vi.fn(async () => undefined),
        deleteTaskAndReload: vi.fn(async () => undefined),
        completeTaskAndReload: vi.fn(async () => undefined),
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
