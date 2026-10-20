import { describe, expect, it, vi } from 'vitest'
import { createTask } from '../App.test-fixtures/tasks'
import { useAppTaskCreationController } from './appTaskCreationController.svelte'
import { activateCachedTaskDetail, cacheTaskRead, clearActiveTasks, evictTask, installActiveTasks } from './tasksState'

const backlogTask = createTask({ id: 'T-1', status: 'backlog' })

function setup() {
  const options = {
    getTasks: () => [backlogTask],
    loadTasks: vi.fn(async () => {}),
    publishTask: vi.fn(),
    showTask: vi.fn<(task: typeof backlogTask) => void | Promise<void>>(),
    runAction: vi.fn(async () => {}),
    reportError: vi.fn(),
  }
  return { options, controller: useAppTaskCreationController(options) }
}

describe('App task creation controller', () => {
  it('opens create and editable backlog task dialogs through one interface', () => {
    const { controller } = setup()
    controller.openNewTask()
    expect(controller.dialog).toEqual({ mode: 'create', task: null })
    controller.openEditTask(backlogTask.id)
    expect(controller.dialog).toEqual({ mode: 'edit', task: backlogTask })
    controller.closeTaskDialog()
    expect(controller.dialog).toBeNull()
  })

  it.each(['board', 'task', 'plugin'] as const)('leaves the current %s location untouched when saving to backlog', async (page) => {
    const { options, controller } = setup()
    const location = { page, selectedTask: page === 'task' ? 'existing-task' : null, filter: 'my-label' }
    const before = { ...location }
    options.showTask.mockImplementation(() => { location.page = 'task'; location.selectedTask = 'T-1'; location.filter = '' })
    controller.openNewTask()
    controller.taskCreated(backlogTask, 'backlog')
    await Promise.resolve()
    expect(controller.dialog).toBeNull()
    expect(location).toEqual(before)
    expect(options.publishTask).toHaveBeenCalledWith(backlogTask)
    expect(options.runAction).not.toHaveBeenCalled()
    expect(options.showTask).not.toHaveBeenCalled()
  })

  it('keeps saved detail available when a real cache refresh omits the new task', async () => {
    const { options, controller } = setup()
    clearActiveTasks()
    options.publishTask.mockImplementation(task => cacheTaskRead(task.projectId, { task, related: [] }))
    options.loadTasks.mockImplementation(async () => { installActiveTasks(backlogTask.projectId, { tasks: [], related: [] }) })
    try {
      controller.openNewTask()
      controller.taskCreated(backlogTask, 'start')
      await Promise.resolve()
      expect(activateCachedTaskDetail(backlogTask.projectId, backlogTask.id)).toEqual(backlogTask)
      expect(controller.dialog).toBeNull()
    } finally {
      evictTask(backlogTask.id)
      clearActiveTasks()
    }
  })

  it('keeps the saved task open when a background refresh fails', async () => {
    const { options, controller } = setup()
    options.loadTasks.mockRejectedValue(new Error('offline'))
    controller.openNewTask()
    controller.taskCreated(backlogTask, 'start')
    await vi.waitFor(() => expect(options.reportError).toHaveBeenCalled())
    expect(controller.dialog).toBeNull()
    expect(options.publishTask).toHaveBeenCalledWith(backlogTask)
    expect(options.showTask).toHaveBeenCalledExactlyOnceWith(backlogTask)
    expect(options.runAction).toHaveBeenCalledTimes(1)
  })

  it('closes and presents the saved task while refresh and startup are unresolved', async () => {
    const { options, controller } = setup()
    let finishRefresh!: () => void
    let finishStart!: () => void
    options.loadTasks.mockImplementation(() => new Promise(resolve => { finishRefresh = resolve }))
    options.runAction.mockImplementation(() => new Promise(resolve => { finishStart = resolve }))
    options.showTask.mockImplementation(() => {
      expect(options.publishTask).toHaveBeenCalledWith(backlogTask)
      expect(controller.dialog).toBeNull()
    })
    controller.openNewTask()
    controller.taskCreated(backlogTask, 'start')
    expect(options.showTask).toHaveBeenCalledExactlyOnceWith(backlogTask)
    expect(options.runAction).toHaveBeenCalledExactlyOnceWith({ taskId: 'T-1', actionPrompt: '' })
    finishRefresh()
    finishStart()
    await Promise.resolve()
    expect(controller.dialog).toBeNull()
  })
  it('starts a task created in another project only after switching to it', async () => {
    const { options, controller } = setup()
    const otherProjectTask = createTask({ id: 'T-9', projectId: 'other-project', status: 'backlog' })
    let finishSwitch!: () => void
    options.showTask.mockImplementation(() => new Promise<void>(resolve => { finishSwitch = resolve }))
    controller.openNewTask()

    controller.taskCreated(otherProjectTask, 'start')

    expect(options.showTask).toHaveBeenCalledExactlyOnceWith(otherProjectTask)
    expect(options.runAction).not.toHaveBeenCalled()
    finishSwitch()
    await vi.waitFor(() => expect(options.runAction).toHaveBeenCalledExactlyOnceWith({ taskId: 'T-9', actionPrompt: '' }))
  })
})
