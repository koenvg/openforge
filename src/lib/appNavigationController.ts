import { get } from 'svelte/store'
import { activeProjectId, currentView, projects, reviewPrs, selectedTaskId, tasks } from './stores'
import { isCrossProjectView } from './views'
import { pushNavState, restoreProjectView } from './router.svelte'
import type { AppView, ReviewPullRequest, Task } from './types'
import { markReviewPrViewed, openUrl } from './ipc'
import { executePluginCommand } from './plugin/pluginRegistry'
import { GITHUB_SYNC_PLUGIN_ID } from './githubSyncPlugin'

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

interface ReviewNavigation {
  nowSeconds(): number
  updateViewed(pr: ReviewPullRequest, viewedAt: number): void
  markViewed(pr: ReviewPullRequest): Promise<void>
  openInPlugin(pr: ReviewPullRequest, projectId: string | null): Promise<boolean>
  openUrl(url: string): Promise<void>
  logError(message: string, error: unknown): void
}

interface AppNavigationControllerOptions {
  router: AppRouter
  loadTasks(): Promise<void>
  getSelectedTask(): Task | null
  getSidebarPluginViewKeys(): ReadonlySet<string>
  closeAttentionOverview(): void
  history?: AppNavigationHistory
  reviewNavigation?: ReviewNavigation
}

export function createAppNavigationController(options: AppNavigationControllerOptions) {
  const history = options.history ?? {
    push: pushNavState,
    restoreProject: restoreProjectView,
  }
  const reviewNavigation = options.reviewNavigation ?? {
    nowSeconds: () => Math.floor(Date.now() / 1000),
    updateViewed: (pr: ReviewPullRequest, viewedAt: number) => {
      reviewPrs.update((list) => list.map((candidate) => (
        candidate.id === pr.id
          ? { ...candidate, viewed_at: viewedAt, viewed_head_sha: pr.head_sha }
          : candidate
      )))
    },
    markViewed: (pr: ReviewPullRequest) => markReviewPrViewed(pr.id, pr.head_sha),
    openInPlugin: (pr: ReviewPullRequest, projectId: string | null) => (
      executePluginCommand(GITHUB_SYNC_PLUGIN_ID, 'open_review_pr', { pr, projectId })
    ),
    openUrl,
    logError: (message: string, error: unknown) => { console.error(message, error) },
  }

  function navigate(view: AppView): void {
    options.router.navigate(view)
  }

  function openTask(taskId: string): void {
    options.router.navigateToTask(taskId)
  }

  async function switchToProject(projectId: string): Promise<void> {
    const activeId = get(activeProjectId)
    const view = get(currentView)
    if (activeId === projectId && !isCrossProjectView(view, options.getSidebarPluginViewKeys())) {
      if (view !== 'board') {
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
    if (task.project_id && task.project_id !== get(activeProjectId)) {
      activeProjectId.set(task.project_id)
      await options.loadTasks()
    }
    options.router.navigateToTask(task.id)
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

  async function openReviewFromOverview(
    pr: ReviewPullRequest,
    projectId: string | null,
  ): Promise<void> {
    options.closeAttentionOverview()
    reviewNavigation.updateViewed(pr, reviewNavigation.nowSeconds())
    void reviewNavigation.markViewed(pr).catch((error) => {
      reviewNavigation.logError('[App] Failed to mark review PR viewed:', error)
    })

    try {
      const opened = await reviewNavigation.openInPlugin(pr, projectId)
      if (!opened) await reviewNavigation.openUrl(pr.html_url)
    } catch (error) {
      reviewNavigation.logError('[App] Failed to open PR in review view:', error)
      await reviewNavigation.openUrl(pr.html_url)
    }
  }

  return {
    navigate,
    openTask,
    switchToProject,
    openTaskFromOverview,
    goBack,
    goForward,
    cycleActiveProject,
    openReviewFromOverview,
  }
}
