import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './types'

import { useActionPaletteController } from './actionPaletteController.svelte'
import { activeProjectId } from './stores'

const selectedTask: Task = {
  id: 'T-1',
  initial_prompt: 'Prompt',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  summary: null,
  status: 'doing',
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 1000,
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

  it('confirms before completing (deleting) a task from the palette', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    await controller.executeAction('delete-task')

    expect(confirmSpy).toHaveBeenCalled()
    expect(taskActions.deleteTaskAndReload).toHaveBeenCalledWith(selectedTask.id)
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
    await controller.executeAction('delete-task')

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
})
