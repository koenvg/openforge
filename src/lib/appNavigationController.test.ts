import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { activeProjectId, currentView, focusBoardFilters, pendingTask, projects, selectedTaskId, tasks } from './stores'
import type { Project, Task } from './types'
import { createAppNavigationController } from './appNavigationController'

const projectOne = { id: 'P-1', name: 'One', path: '/one' } as Project
const projectTwo = { id: 'P-2', name: 'Two', path: '/two' } as Project
const rememberedTask = { id: 'T-2', project_id: projectTwo.id } as Task

function createRouter() {
  return {
    navigate: vi.fn(),
    navigateToTask: vi.fn(),
    resetToBoard: vi.fn(),
    back: vi.fn(() => false),
    forward: vi.fn(() => false),
  }
}

describe('App navigation controller', () => {
  beforeEach(() => {
    activeProjectId.set(projectOne.id)
    currentView.set('board')
    projects.set([projectOne, projectTwo])
    selectedTaskId.set(null)
    pendingTask.set(null)
    tasks.set([])
    focusBoardFilters.set(new Map())
  })

  it('restores a remembered task after the target project tasks load', async () => {
    const calls: string[] = []
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(async () => {
        calls.push('load')
        tasks.set([rememberedTask])
      }),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
      history: {
        push: vi.fn(() => { calls.push('push') }),
        restoreProject: vi.fn(() => {
          calls.push('restore')
          return rememberedTask.id
        }),
      },
    })

    await controller.switchToProject(projectTwo.id)

    expect(calls).toEqual(['push', 'restore', 'load'])
    expect(get(activeProjectId)).toBe(projectTwo.id)
    expect(get(selectedTaskId)).toBe(rememberedTask.id)
  })

  it('loads a related task project before opening the task', async () => {
    const calls: string[] = []
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(async () => {
        calls.push('load')
        tasks.set([rememberedTask])
      }),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
    })

    await controller.openTaskInProject(rememberedTask.id, projectTwo.id)

    expect(calls).toEqual(['load'])
    expect(get(activeProjectId)).toBe(projectTwo.id)
    expect(router.navigateToTask).toHaveBeenCalledWith(rememberedTask.id)
  })

  it('keeps a completed related task available after switching projects', async () => {
    const completedTask = { ...rememberedTask, status: 'done' } as Task
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(async () => { tasks.set([]) }),
      loadTaskDetail: vi.fn(async () => completedTask),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
    })

    await controller.openTaskInProject(completedTask.id, projectTwo.id)

    expect(get(activeProjectId)).toBe(projectTwo.id)
    expect(get(pendingTask)).toBe(completedTask)
    expect(router.navigateToTask).toHaveBeenCalledWith(completedTask.id)
  })

  it('loads a task project before opening a task from the attention overview', async () => {
    const calls: string[] = []
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(async () => {
        calls.push('load')
        tasks.set([rememberedTask])
      }),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(() => { calls.push('close') }),
    })

    await controller.openTaskFromOverview(rememberedTask)

    expect(calls).toEqual(['close', 'load'])
    expect(get(activeProjectId)).toBe(projectTwo.id)
    expect(router.navigateToTask).toHaveBeenCalledWith(rememberedTask.id)
  })

  it('reloads project tasks after browser-style history crosses projects', async () => {
    const router = createRouter()
    router.back.mockImplementation(() => {
      activeProjectId.set(projectTwo.id)
      selectedTaskId.set(rememberedTask.id)
      return true
    })
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(async () => { tasks.set([rememberedTask]) }),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
    })

    await controller.goBack()

    expect(router.back).toHaveBeenCalledOnce()
    expect(get(selectedTaskId)).toBe(rememberedTask.id)
  })

  it('cycles projects only from an unselected board when board-only is requested', async () => {
    let selectedTask: Task | null = rememberedTask
    const controller = createAppNavigationController({
      router: createRouter(),
      loadTasks: vi.fn(),
      getSelectedTask: () => selectedTask,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
      history: {
        push: vi.fn(),
        restoreProject: vi.fn(() => null),
      },
    })

    await controller.cycleActiveProject('next', { boardOnly: true })
    expect(get(activeProjectId)).toBe(projectOne.id)

    selectedTask = null
    await controller.cycleActiveProject('next', { boardOnly: true })
    expect(get(activeProjectId)).toBe(projectTwo.id)
  })

  it('re-clicking the active project while already on its board jumps to Focus without resetting', async () => {
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(),
      getSelectedTask: () => null,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
    })
    focusBoardFilters.set(new Map([[projectOne.id, 'backlog']]))

    await controller.switchToProject(projectOne.id)

    expect(get(focusBoardFilters).get(projectOne.id)).toBe('focus')
    // Nothing is drilled in, so there is nothing to back out of. Resetting would only
    // manufacture a junk history entry.
    expect(router.resetToBoard).not.toHaveBeenCalled()
  })

  it('re-clicking the active project with a task detail open closes it and jumps to Focus', async () => {
    const router = createRouter()
    const controller = createAppNavigationController({
      router,
      loadTasks: vi.fn(),
      getSelectedTask: () => rememberedTask,
      getSidebarPluginViewKeys: () => new Set(),
      closeAttentionOverview: vi.fn(),
    })
    focusBoardFilters.set(new Map([[projectOne.id, 'backlog']]))
    selectedTaskId.set(rememberedTask.id)

    await controller.switchToProject(projectOne.id)

    expect(router.resetToBoard).toHaveBeenCalledOnce()
    expect(get(focusBoardFilters).get(projectOne.id)).toBe('focus')
  })

})
