import { get } from 'svelte/store'
import {
  activeProjectId,
  activeResolvedRepo,
  activeSessions,
  error,
  globalExcludedPrRepos,
  isLoading,
  projectAttention,
  projects,
  reviewPrs,
  tasks,
  ticketPrs,
} from './stores'
import {
  forceGithubSync,
  getConfig,
  getLatestSessions,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPullRequests,
  getReviewPrs,
  getTasksForProject,
} from './ipc'
import { applyProjectOrder } from './projectOrder'
import { buildTicketPullRequestMap } from './pullRequestStore'
import type { ProjectAttention } from './types'

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
      if (projectId) {
        const resolvedRepoRaw = await getProjectConfig(projectId, 'resolved_repo')
        activeResolvedRepo.set(
          typeof resolvedRepoRaw === 'string' && resolvedRepoRaw.includes('/') ? resolvedRepoRaw : null,
        )
      } else {
        activeResolvedRepo.set(null)
      }
    } catch (e) {
      logError('Failed to refresh PR counts:', e)
    }
  }

  async function loadProjectAttention(): Promise<void> {
    try {
      const summaries = await getProjectAttention()
      const map = new Map<string, ProjectAttention>()
      for (const summary of summaries) {
        map.set(summary.project_id, summary)
      }
      projectAttention.set(map)
    } catch (e) {
      logError('Failed to load project attention:', e)
    }
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
    triggerGithubSync,
  }
}
