import { describe, expect, it, vi } from 'vitest'
import type { Project, Task } from './types'
import { createAppProjectController } from './appProjectController'

const task = { id: 'T-1' } as Task

function createOptions() {
  let filters = new Map<string, unknown>([['P-1', { query: 'stale' }]])
  return {
    options: {
      clearPendingTask: vi.fn(),
      clearSelectedTask: vi.fn(),
      getFocusBoardFilters: () => filters,
      setFocusBoardFilters: vi.fn((next: Map<string, unknown>) => { filters = next }),
      loadTasks: vi.fn(),
      loadPullRequests: vi.fn(),
      refreshPrCounts: vi.fn(),
      loadProjects: vi.fn(),
      setActiveProject: vi.fn(),
      closeProjectSetup: vi.fn(),
      openProjectSettings: vi.fn(),
    },
    get filters() { return filters },
  }
}

describe('App project controller', () => {
  it('reconciles pending and selected Tasks after task data changes', () => {
    const { options } = createOptions()
    const controller = createAppProjectController(options)

    controller.reconcileTasks({ tasks: [task], pendingTask: task, selectedTaskId: task.id })

    expect(options.clearPendingTask).toHaveBeenCalledOnce()
    expect(options.clearSelectedTask).not.toHaveBeenCalled()

    controller.reconcileTasks({ tasks: [], pendingTask: null, selectedTaskId: task.id })

    expect(options.clearSelectedTask).toHaveBeenCalledOnce()
  })

  it('refreshes project data once per selection and clears stale board filters', () => {
    const state = createOptions()
    const controller = createAppProjectController(state.options)

    controller.selectProject('P-1')
    controller.selectProject('P-1')
    controller.selectProject(null)

    expect(state.options.loadTasks).toHaveBeenCalledOnce()
    expect(state.options.loadPullRequests).toHaveBeenCalledOnce()
    expect(state.options.refreshPrCounts).toHaveBeenCalledOnce()
    expect(state.filters.has('P-1')).toBe(false)
  })

  it('activates a created project before opening its settings', async () => {
    const calls: string[] = []
    const state = createOptions()
    state.options.closeProjectSetup.mockImplementation(() => { calls.push('close') })
    state.options.setActiveProject.mockImplementation(() => { calls.push('activate') })
    state.options.loadProjects.mockImplementation(async () => { calls.push('load') })
    state.options.openProjectSettings.mockImplementation(() => { calls.push('settings') })
    const controller = createAppProjectController(state.options)

    await controller.projectCreated({ id: 'P-2' } as Project)

    expect(calls).toEqual(['close', 'activate', 'load', 'settings'])
  })
})
