import { get } from 'svelte/store'
import {
  activeProjectId,
  activeResolvedRepo,
  activeSessions,
  taskAttentionLoaded,
  taskAttentionRows,
  error,
  globalExcludedPrRepos,
  hiddenProjectIds,
  isLoading,
  projectAttention,
  projectResolvedRepos,
  projects,
  reviewPrs,
  dependencyReferenceTasks,
  tasks,
  ticketPrs,
} from './stores'
import {
  forceGithubSync,
  getTaskAttention,
  getConfig,
  getLatestSessions,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPullRequests,
  getReviewPrs,
  getTaskRelationshipReferences,
  getTasksForProject,
} from './ipc'
import { applyProjectOrder } from './projectOrder'
import { loadHiddenProjectIds } from './projectVisibility'
import { githubSyncFailureMessage } from './githubSyncResult'
import { buildTicketPullRequestMap } from './pullRequestStore'
import type { ProjectAttention } from './types'

// Task attention refreshes are throttled because lifecycle events can stream rapidly.
// A trailing throttle coalesces bursts while guaranteeing a refresh at least once per interval.
const ATTENTION_COUNT_REFRESH_INTERVAL_MS = 500

type LogError = (message: string, error: unknown) => void

export interface AppDataOrchestratorOptions {
  setShowProjectSetup(show: boolean): void
  logError?: LogError
}


interface TaskLoadState {
  started: boolean
  refreshPending: boolean
  promise: Promise<void>
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
  let attentionRefreshGeneration = 0
  let projectAttentionLoadPromise: Promise<void> | null = null
  const taskLoads = new Map<string, TaskLoadState>()

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

      try {
        hiddenProjectIds.set(await loadHiddenProjectIds())
      } catch (hiddenError) {
        logError('Failed to load hidden projects:', hiddenError)
      }

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

  async function refreshTasksForProject(projectId: string): Promise<void> {
    try {
      const [activeTasks, relationshipReferences] = await Promise.all([
        getTasksForProject(projectId),
        getTaskRelationshipReferences(projectId),
      ])
      // A newer project switch may have started while this fetch was in flight (e.g.
      // rapid ⌘-cycling or a sidebar switch, each of which also kicks off a load).
      // Don't clobber the tasks store with a stale project's data — the newer load
      // will populate the correct tasks for the now-active project.
      if (get(activeProjectId) !== projectId) {
        return
      }
      tasks.set(activeTasks)
      dependencyReferenceTasks.set(relationshipReferences)
      await loadSessions()
    } catch (e) {
      dependencyReferenceTasks.set([])
      logError('Failed to load tasks:', e)
      error.set(String(e))
    }
  }

  function loadTasks(): Promise<void> {
    const projectId = get(activeProjectId)
    if (!projectId) {
      dependencyReferenceTasks.set([])
      return Promise.resolve()
    }

    const currentLoad = taskLoads.get(projectId)
    if (currentLoad) {
      if (currentLoad.started) currentLoad.refreshPending = true
      return currentLoad.promise
    }

    isLoading.set(true)
    const taskLoad: TaskLoadState = {
      started: false,
      refreshPending: false,
      promise: Promise.resolve(),
    }
    taskLoad.promise = Promise.resolve()
      .then(async () => {
        taskLoad.started = true
        do {
          taskLoad.refreshPending = false
          await refreshTasksForProject(projectId)
        } while (taskLoad.refreshPending && get(activeProjectId) === projectId)
      })
      .finally(() => {
        if (taskLoads.get(projectId) === taskLoad) taskLoads.delete(projectId)
        isLoading.set(taskLoads.size > 0)
      })
    taskLoads.set(projectId, taskLoad)
    return taskLoad.promise
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

  // Sidebar badges and the Focus lane consume exactly the same backend-owned Task rows.
  async function refreshAttentionCounts(): Promise<void> {
    const generation = ++attentionRefreshGeneration
    try {
      const rows = await getTaskAttention()
      if (generation !== attentionRefreshGeneration) return
      taskAttentionRows.set(rows)
      taskAttentionLoaded.set(true)
    } catch (e) {
      if (generation === attentionRefreshGeneration) {
        logError('Failed to refresh attention counts:', e)
      }
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
      const result = await forceGithubSync()
      const failureMessage = githubSyncFailureMessage(result)
      if (failureMessage) {
        error.set(failureMessage)
        return
      }
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
