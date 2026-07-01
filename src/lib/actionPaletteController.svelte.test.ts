import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './types'

vi.mock('./actions', () => ({
  loadActions: vi.fn(),
  getEnabledActions: vi.fn((actions) => actions.filter((action: { enabled: boolean }) => action.enabled)),
}))

import { useActionPaletteController } from './actionPaletteController.svelte'
import { activeProjectId } from './stores'
import { loadActions } from './actions'

const selectedTask: Task = {
  id: 'T-1',
  initial_prompt: 'Prompt',
  prompt: null,
  title: null,
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

const laterSelectedTask: Task = {
  ...selectedTask,
  id: 'T-2',
}

describe('useActionPaletteController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeProjectId.set('proj-1')
    vi.mocked(loadActions).mockResolvedValue([])
  })

  it('opens with enabled project actions and executes custom actions against the task captured at open time', async () => {
    let currentSelectedTask: Task | null = selectedTask
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
    }
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'custom-1', name: 'Custom', prompt: 'Do custom work', builtin: false, enabled: true },
      { id: 'disabled-1', name: 'Disabled', prompt: 'Ignore me', builtin: false, enabled: false },
    ])

    const controller = useActionPaletteController({
      getSelectedTask: () => currentSelectedTask,
      taskActions,
      goBack: vi.fn(),
      showSearchTasks: vi.fn(),
      showNewTask: vi.fn(),
      showProjectSwitcher: vi.fn(),
      triggerGithubSync: vi.fn(async () => undefined),
    })

    await controller.openActionPalette()
    currentSelectedTask = laterSelectedTask
    await controller.executeAction('custom-action-custom-1')

    expect(controller.showActionPalette).toBe(false)
    expect(taskActions.handleRunAction).toHaveBeenCalledWith({
      taskId: selectedTask.id,
      actionPrompt: 'Do custom work',
      agent: null,
    })
  })

  it('delegates built-in palette actions to UI callbacks and task actions', async () => {
    const taskActions = {
      handleRunAction: vi.fn(async () => undefined),
      deleteTaskAndReload: vi.fn(async () => undefined),
      mergeReadyPullRequest: vi.fn(async () => undefined),
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

    await controller.openActionPalette()
    await controller.executeAction('new-task')
    await controller.openActionPalette()
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

    await controller.openActionPalette()
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

    await controller.openActionPalette()
    await controller.executeAction('delete-task')

    expect(confirmSpy).toHaveBeenCalled()
    expect(taskActions.deleteTaskAndReload).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
