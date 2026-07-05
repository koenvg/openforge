import { get } from 'svelte/store'
import {
  activeProjectId,
  activeResolvedRepo,
  activeSessions,
  attentionCountByProject,
  error,
  globalExcludedPrRepos,
  isLoading,
  projectAttention,
  projectResolvedRepos,
  projects,
  reviewPrs,
  tasks,
  ticketPrs,
} from './stores'
import {
  forceGithubSync,
  getAllTasks,
  getConfig,
  getLatestSessions,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPullRequests,
  getReviewPrs,
  getTasksForProject,
} from './ipc'
import { DEFAULT_FOCUS_STATES, loadFocusFilterStates, loadOutOfFocusTaskIds } from './boardFilters'
import { buildAttentionCountByProject } from './attentionCounts'
import { applyProjectOrder } from './projectOrder'
import { buildTicketPullRequestMap } from './pullRequestStore'
import type { ProjectAttention } from './types'
import type { TaskState } from './taskState'

// The green-dot refresh fans out across every project (all tasks + sessions + per-project
// board config), so it is throttled rather than run inline: loadProjectAttention fires on
// nearly every agent-event, most of which are streaming no-ops that cannot change any focus
// count. A trailing throttle (a pending timer is never reset) coalesces bursts into one fetch
// while still guaranteeing the count refreshes at least once per interval — a resetting
// debounce would let a continuously-streaming agent starve the refresh for every project.
const ATTENTION_COUNT_REFRESH_INTERVAL_MS = 500

type LogError = (message: string, error: unknown) => void

export interface AppDataOrchestratorOptions {
  setShowProjectSetup(show: boolean): void
  logError?: LogError
}

function defaultLogError(message: string, errorValue: unknown): void {
  console.error(message, errorValue)
}

async function loadGlobalExcludedRepos(): Promise<Set<string>> {
  try {
    // The "All Pull Requests" repo filter is a single global list — not per-project —
    // so the sidebar badge is constant regardless of which project is active.
    const val = await getConfig('pr_excluded_repos')
    if (!val) return new Set()

    const parsed = JSON.parse(val)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    // No exclusion config — count all
    return new Set()
  }
}


export function useAppDataOrchestrator(options: AppDataOrchestratorOptions) {
  const logError = options.logError ?? defaultLogError
  let isSyncing = $state(false)
  let attentionCountRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let projectAttentionLoadPromise: Promise<void> | null = null

  async function loadProjects(): Promise<void> {
    try {
      const fetchedProjects = await getProjects()
      let savedOrder: string | null = null

      try {
        savedOrder = await getConfig('project_sidebar_order')
      } catch (configError) {
        logError('Failed to load saved project order:', configError)
      }

      const orderedProjects = applyProjectOrder(fetchedProjects, savedOrder)
      projects.set(orderedProjects)

      const currentActiveProjectId = get(activeProjectId)
      if (currentActiveProjectId && !orderedProjects.find(p => p.id === currentActiveProjectId)) {
        activeProjectId.set(orderedProjects.length > 0 ? orderedProjects[0].id : null)
      } else if (orderedProjects.length > 0 && !currentActiveProjectId) {
        activeProjectId.set(orderedProjects[0].id)
      }

      if (orderedProjects.length === 0) {
        options.setShowProjectSetup(true)
      }
    } catch (e) {
      logError('Failed to load projects:', e)
      error.set(String(e))
    }
  }

  async function loadSessions(): Promise<void> {
    try {
      const taskIds = get(tasks).map(t => t.id)
      if (taskIds.length === 0) return

      const sessions = await getLatestSessions(taskIds)
      const updated = new Map(get(activeSessions))
      for (const session of sessions) {
        updated.set(session.ticket_id, session)
      }
      activeSessions.set(updated)
    } catch (e) {
      logError('Failed to load sessions:', e)
    }
  }

  async function loadTasks(): Promise<void> {
    const projectId = get(activeProjectId)
    if (!projectId) return

    isLoading.set(true)
    try {
      tasks.set(await getTasksForProject(projectId))
      await loadSessions()
    } catch (e) {
      logError('Failed to load tasks:', e)
      error.set(String(e))
    } finally {
      isLoading.set(false)
    }
  }

  async function loadPullRequests(): Promise<void> {
    try {
      const prs = await getPullRequests()
      ticketPrs.set(buildTicketPullRequestMap(prs, get(ticketPrs)))
    } catch (e) {
      logError('Failed to load pull requests:', e)
    }
  }

  async function refreshPrCounts(): Promise<void> {
    try {
      // Global filter for the all-repos "All Pull Requests" badge — independent of the
      // active project, so the sidebar count stays constant across project switches.
      globalExcludedPrRepos.set(await loadGlobalExcludedRepos())

      // The all-repos review list backs both derived badges: the sidebar (all repos, minus
      // the global filter) and the rail (scoped to the active repo). Both are unopened-only
      // and skip "DO NOT REVIEW" PRs; see stores.ts / prReviewBadgeCounts.ts.
      reviewPrs.set(await getReviewPrs())

      // Resolve the active project's repo so the rail badge can scope to it. The sidecar
      // writes the project's git origin into the 'resolved_repo' project config.
      const projectId = get(activeProjectId)
      let activeRepo: string | null = null
      if (projectId) {
        const resolvedRepoRaw = await getProjectConfig(projectId, 'resolved_repo')
        activeRepo = typeof resolvedRepoRaw === 'string' && resolvedRepoRaw.includes('/') ? resolvedRepoRaw : null
      }
      activeResolvedRepo.set(activeRepo)

      // Resolve every project's repo so the sidebar can show a per-project review count, not
      // just the active project's. Reuse the value already fetched for the active project.
      const repoEntries = await Promise.all(
        get(projects).map(async (project): Promise<[string, string | null]> => {
          if (project.id === projectId) return [project.id, activeRepo]
          try {
            const raw = await getProjectConfig(project.id, 'resolved_repo')
            return [project.id, typeof raw === 'string' && raw.includes('/') ? raw : null]
          } catch {
            return [project.id, null]
          }
        }),
      )
      projectResolvedRepos.set(new Map(repoEntries))
    } catch (e) {
      logError('Failed to refresh PR counts:', e)
    }
  }

  function loadProjectAttention(): Promise<void> {
    projectAttentionLoadPromise ??= (async () => {
      try {
        const summaries = await getProjectAttention()
        const map = new Map<string, ProjectAttention>()
        for (const summary of summaries) {
          map.set(summary.project_id, summary)
        }
        projectAttention.set(map)
      } catch (e) {
        logError('Failed to load project attention:', e)
      } finally {
        projectAttentionLoadPromise = null
        scheduleAttentionCountRefresh()
      }
    })()

    return projectAttentionLoadPromise
  }

  // Sidebar green dot: the count of Focus-tab tasks needing attention per project. Computed on
  // the frontend with the board's own getFilterCounts so the dot equals the board's Focus count
  // exactly (distinct tasks, excluding in-flight agents and Out of Focus tasks), rather than
  // the backend's summed signals which over-counted PR comments and double-counted tasks.
  async function refreshAttentionCounts(): Promise<void> {
    try {
      const projectList = get(projects)
      const allTasks = await getAllTasks()
      const doingIds = allTasks.filter((task) => task.status === 'doing').map((task) => task.id)
      const sessionList = doingIds.length > 0 ? await getLatestSessions(doingIds) : []
      const sessions = new Map(sessionList.map((session) => [session.ticket_id, session]))

      const focusStatesByProject = new Map<string, TaskState[]>()
      const outOfFocusByProject = new Map<string, Set<string>>()
      await Promise.all(
        projectList.map(async (project) => {
          const [focusStates, outOfFocusTaskIds] = await Promise.all([
            loadFocusFilterStates(project.id).catch(() => DEFAULT_FOCUS_STATES),
            loadOutOfFocusTaskIds(project.id).catch(() => new Set<string>()),
          ])
          focusStatesByProject.set(project.id, focusStates)
          if (outOfFocusTaskIds.size > 0) outOfFocusByProject.set(project.id, outOfFocusTaskIds)
        }),
      )

      attentionCountByProject.set(
        buildAttentionCountByProject(allTasks, sessions, get(ticketPrs), focusStatesByProject, outOfFocusByProject),
      )
    } catch (e) {
      logError('Failed to refresh attention counts:', e)
    }
  }

  // Trailing throttle: if a refresh is already pending, leave its deadline alone so a steady
  // stream of triggers can't push it out forever. Called both from loadProjectAttention and
  // when board-only state (Out of Focus) changes without emitting a desktop event.
  function scheduleAttentionCountRefresh(): void {
    if (attentionCountRefreshTimer !== null) return
    attentionCountRefreshTimer = setTimeout(() => {
      attentionCountRefreshTimer = null
      void refreshAttentionCounts()
    }, ATTENTION_COUNT_REFRESH_INTERVAL_MS)
  }

  async function triggerGithubSync(): Promise<void> {
    if (isSyncing) return

    isSyncing = true
    try {
      await forceGithubSync()
      await loadPullRequests()
      await loadTasks()
    } catch (e) {
      logError('Failed to sync GitHub:', e)
      error.set(String(e))
    } finally {
      isSyncing = false
    }
  }

  return {
    get isSyncing() {
      return isSyncing
    },
    loadProjects,
    loadTasks,
    loadSessions,
    loadPullRequests,
    refreshPrCounts,
    loadProjectAttention,
    refreshAttentionCounts,
    scheduleAttentionCountRefresh,
    triggerGithubSync,
  }
}
