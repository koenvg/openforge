import type { Project, TaskDetail } from './types'

interface TaskSelectionState {
  tasks: TaskDetail[]
  pendingTask: TaskDetail | null
  selectedTaskId: string | null
  selectedTaskDetailExists?: boolean
}

interface AppProjectControllerOptions<TFilter> {
  clearPendingTask(): void
  clearSelectedTask(): void
  getFocusBoardFilters(): ReadonlyMap<string, TFilter>
  setFocusBoardFilters(filters: Map<string, TFilter>): void
  loadTasks(): void | Promise<unknown>
  loadPullRequests(): void | Promise<unknown>
  refreshPrCounts(): void | Promise<unknown>
  loadProjects(): void | Promise<unknown>
  setActiveProject(projectId: string): void
  closeProjectSetup(): void
  openProjectSettings(): void
}

export function createAppProjectController<TFilter>(options: AppProjectControllerOptions<TFilter>) {
  let selectedProjectId: string | null = null

  function reconcileTasks(state: TaskSelectionState): void {
    if (state.pendingTask && state.tasks.some((task) => task.id === state.pendingTask?.id)) {
      options.clearPendingTask()
    }

    if (!state.selectedTaskId) return
    const selectedTaskExists = state.tasks.some((task) => task.id === state.selectedTaskId)
      || state.pendingTask?.id === state.selectedTaskId
      || state.selectedTaskDetailExists === true
    if (!selectedTaskExists) {
      options.clearSelectedTask()
    }
  }

  function selectProject(projectId: string | null): void {
    if (projectId === selectedProjectId) return
    selectedProjectId = projectId

    if (!projectId) return
    const nextFilters = new Map(options.getFocusBoardFilters())
    nextFilters.delete(projectId)
    options.setFocusBoardFilters(nextFilters)
    void options.loadTasks()
    void options.loadPullRequests()
    void options.refreshPrCounts()
  }

  async function projectCreated(project: Project): Promise<void> {
    options.closeProjectSetup()
    options.setActiveProject(project.id)
    await options.loadProjects()
    options.openProjectSettings()
  }

  return {
    reconcileTasks,
    selectProject,
    projectCreated,
  }
}
