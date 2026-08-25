import { get } from 'svelte/store'
import { activeProjectId, currentView, pendingTask, projects, selectedTaskId, tasks } from './stores'
import { getTaskDetail } from './ipc'
import { isCrossProjectView } from './views'
import { pushNavState, restoreProjectView, selectFocusBoardTab } from './router.svelte'
import type { AppView, Task } from './types'

interface AppRouter {
  navigate(view: AppView): void
  navigateToTask(taskId: string): void
  resetToBoard(): void
  back(): boolean
  forward(): boolean
}

interface AppNavigationHistory {
  push(): void
  restoreProject(projectId: string): string | null
}

interface AppNavigationControllerOptions {
  router: AppRouter
  loadTasks(): Promise<void>
  loadTaskDetail?(taskId: string): Promise<Task>
  getSelectedTask(): Task | null
  getSidebarPluginViewKeys(): ReadonlySet<string>
  closeAttentionOverview(): void
  history?: AppNavigationHistory
}

export function createAppNavigationController(options: AppNavigationControllerOptions) {
  const history = options.history ?? {
    push: pushNavState,
    restoreProject: restoreProjectView,
  }
  const loadTaskDetail = options.loadTaskDetail ?? getTaskDetail

  function navigate(view: AppView): void {
    options.router.navigate(view)
  }

  function openTask(taskId: string): void {
    options.router.navigateToTask(taskId)
  }

  async function openTaskInProject(taskId: string, projectId: string | null = null): Promise<void> {
    if (projectId && projectId !== get(activeProjectId)) {
      activeProjectId.set(projectId)
      await options.loadTasks()
    }
    if (!get(tasks).some((task) => task.id === taskId)) {
      pendingTask.set(await loadTaskDetail(taskId))
    }
    options.router.navigateToTask(taskId)
  }

  async function switchToProject(projectId: string): Promise<void> {
    const activeId = get(activeProjectId)
    const view = get(currentView)
    if (activeId === projectId && !isCrossProjectView(view, options.getSidebarPluginViewKeys())) {
      if (view !== 'board') {
        options.router.resetToBoard()
        return
      }

      // The board is already showing, so the repeat click jumps to Focus. A task detail
      // also renders on the board view, so when one is open the click has to back out of
      // it too. Otherwise the Focus tab it selects stays hidden behind the detail and the
      // row does nothing.
      selectFocusBoardTab(projectId)
      if (options.getSelectedTask() !== null) {
        options.router.resetToBoard()
      }
      return
    }

    history.push()
    activeProjectId.set(projectId)
    const rememberedTaskId = history.restoreProject(projectId)

    if (rememberedTaskId) {
      await options.loadTasks()
      if (get(activeProjectId) === projectId && get(tasks).some((task) => task.id === rememberedTaskId)) {
        selectedTaskId.set(rememberedTaskId)
      }
    }
  }

  async function openTaskFromOverview(task: Task): Promise<void> {
    options.closeAttentionOverview()
    await openTaskInProject(task.id, task.project_id)
  }

  async function historyNavigate(move: () => boolean): Promise<void> {
    const previousProjectId = get(activeProjectId)
    if (!move()) return

    const nextProjectId = get(activeProjectId)
    if (!nextProjectId || nextProjectId === previousProjectId) return

    const restoredTaskId = get(selectedTaskId)
    if (!restoredTaskId) return

    await options.loadTasks()
    if (get(activeProjectId) === nextProjectId && get(tasks).some((task) => task.id === restoredTaskId)) {
      selectedTaskId.set(restoredTaskId)
    }
  }

  function goBack(): Promise<void> {
    return historyNavigate(() => options.router.back())
  }

  function goForward(): Promise<void> {
    return historyNavigate(() => options.router.forward())
  }

  async function cycleActiveProject(
    direction: 'previous' | 'next',
    cycleOptions?: { boardOnly?: boolean },
  ): Promise<void> {
    if (cycleOptions?.boardOnly && (get(currentView) !== 'board' || options.getSelectedTask() !== null)) {
      return
    }

    const projectList = get(projects)
    if (projectList.length === 0) return

    const currentIndex = projectList.findIndex((project) => project.id === get(activeProjectId))
    const nextIndex = direction === 'next'
      ? (currentIndex < 0 ? 0 : (currentIndex + 1) % projectList.length)
      : (currentIndex <= 0 ? projectList.length - 1 : currentIndex - 1)

    await switchToProject(projectList[nextIndex].id)
  }

  return {
    navigate,
    openTask,
    openTaskInProject,
    switchToProject,
    openTaskFromOverview,
    goBack,
    goForward,
    cycleActiveProject,
  }
}
