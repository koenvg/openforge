import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ProjectAttention, PullRequestInfo, TaskAttentionRow } from './types'

vi.mock('./ipc', () => ({
  forceGithubSync: vi.fn(),
  getTaskAttention: vi.fn(),
  getConfig: vi.fn(),
  getLatestSessions: vi.fn(),
  getProjectAttention: vi.fn(),
  getProjectConfig: vi.fn(),
  getProjects: vi.fn(),
  getPullRequests: vi.fn(),
  getReviewPrs: vi.fn(),
  getTaskDetail: vi.fn(),
  getTasksForProject: vi.fn(),
}))

import { useAppDataOrchestrator } from './appDataOrchestrator.svelte'
import type { Task } from './types'
import {
  activeProjectId,
  activeResolvedRepo,
  activeSessions,
  attentionCountByProject,
  taskAttentionLoaded,
  taskAttentionRows,
  error,
  globalExcludedPrRepos,
  isLoading,
  projectAttention,
  projects,
  projectResolvedRepos,
  reviewPrs,
  dependencyReferenceTasks,
  reviewRequestCount,
  reviewRequestCountByProject,
  activeRepoReviewRequestCount,
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
  getTaskDetail,
  getTasksForProject,
} from './ipc'

function makeTask(id: string, projectId: string): Task {
  return {
    id,
    initial_prompt: id,
    status: 'doing',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: projectId,
    created_at: 1000,
    updated_at: 1000,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}


function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'PR',
    url: 'https://example.com/pr',
    state: 'open',
    merged_at: null,
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    ...overrides,
  }
}

describe('useAppDataOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeProjectId.set(null)
    activeResolvedRepo.set(null)
    activeSessions.set(new Map())
    error.set(null)
    globalExcludedPrRepos.set(new Set())
    isLoading.set(false)
    projectAttention.set(new Map())
    taskAttentionLoaded.set(false)
    taskAttentionRows.set([])
    projectResolvedRepos.set(new Map())
    projects.set([])
    reviewPrs.set([])
    dependencyReferenceTasks.set([])
    tasks.set([])
    ticketPrs.set(new Map())

    vi.mocked(getTaskAttention).mockResolvedValue([])
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(getLatestSessions).mockResolvedValue([])
    vi.mocked(getProjectAttention).mockResolvedValue([])
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getProjects).mockResolvedValue([])
    vi.mocked(getPullRequests).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getTaskDetail).mockRejectedValue(new Error('not found'))
    vi.mocked(getTasksForProject).mockResolvedValue([])
    vi.mocked(forceGithubSync).mockResolvedValue({} as any)
  })

  it('loads completed dependency tasks into dependency-only references without adding them to active tasks', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    const completedDependency = makeTask('T-done', 'proj-1')
    completedDependency.status = 'done'
    completedDependency.initial_prompt = 'Completed prerequisite'
    const visibleDependency = makeTask('T-visible', 'proj-1')
    const dependent = makeTask('T-child', 'proj-1')
    dependent.depends_on = [completedDependency.id, visibleDependency.id, 'T-missing']

    vi.mocked(getTasksForProject).mockResolvedValue([dependent, visibleDependency])
    vi.mocked(getTaskDetail).mockImplementation(async (taskId: string) => {
      if (taskId === completedDependency.id) return completedDependency
      throw new Error('not found')
    })

    await orchestrator.loadTasks()

    expect(get(tasks).map((task) => task.id)).toEqual(['T-child', 'T-visible'])
    expect(get(dependencyReferenceTasks).map((task) => task.id)).toEqual(['T-done'])
    expect(getLatestSessions).toHaveBeenCalledWith(['T-child', 'T-visible'])
  })


  it('loads pull requests while preserving locally definitive PR state', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    const locallyMerged = createPullRequest({ state: 'merged', merged_at: 1000 })
    const locallyDirty = createPullRequest({ id: 99, ticket_id: 'T-99', mergeable: false, mergeable_state: 'dirty' })
    const locallyReady = createPullRequest({
      id: 100,
      ticket_id: 'T-100',
      head_sha: 'ready-sha',
      merge_readiness_status: 'ready_to_merge',
      merge_readiness_action: 'merge',
      readiness_source_head_sha: 'ready-sha',
      readiness_updated_at: 3000,
    })
    ticketPrs.set(new Map([
      ['T-42', [locallyMerged]],
      ['T-99', [locallyDirty]],
      ['T-100', [locallyReady]],
    ]))

    vi.mocked(getPullRequests).mockResolvedValue([
      { ...locallyMerged, state: 'open', merged_at: null },
      { ...locallyDirty, mergeable: null, mergeable_state: 'unknown' },
      {
        ...locallyReady,
        mergeable: null,
        mergeable_state: 'unknown',
        merge_readiness_status: 'readiness_unknown',
        merge_readiness_action: 'wait_for_github',
        readiness_updated_at: 4000,
      },
    ])

    await orchestrator.loadPullRequests()

    const loadedPrs = get(ticketPrs)
    expect(loadedPrs.get('T-42')?.[0].state).toBe('merged')
    expect(loadedPrs.get('T-42')?.[0].merged_at).toBe(1000)
    expect(loadedPrs.get('T-99')?.[0].mergeable).toBe(false)
    expect(loadedPrs.get('T-99')?.[0].mergeable_state).toBe('dirty')
    expect(loadedPrs.get('T-100')?.[0].merge_readiness_status).toBe('ready_to_merge')
    expect(loadedPrs.get('T-100')?.[0].merge_readiness_action).toBe('merge')
    expect(loadedPrs.get('T-100')?.[0].readiness_updated_at).toBe(3000)
  })

  it('populates the all-repos review list so the sidebar badge derives from it', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null, labels: [] },
      { repo_owner: 'other', repo_name: 'svc', viewed_at: null, labels: [] },
      { repo_owner: 'visible', repo_name: 'seen', viewed_at: 123, labels: [] },
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(reviewPrs)).toHaveLength(3)
    // Two unopened across all repos; the viewed one does not count.
    expect(get(reviewRequestCount)).toBe(2)
  })

  it('derives the sidebar count from a GLOBAL exclusion filter, not per-project config', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    // Global filter comes from global config, not getProjectConfig.
    vi.mocked(getConfig).mockImplementation(async (key: string) =>
      key === 'pr_excluded_repos' ? JSON.stringify(['hidden/repo']) : null,
    )
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null, labels: [] },
      { repo_owner: 'hidden', repo_name: 'repo', viewed_at: null, labels: [] },
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(globalExcludedPrRepos).has('hidden/repo')).toBe(true)
    expect(get(reviewRequestCount)).toBe(1)
  })

  it('sidebar count stays constant when only the resolved repo changes', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'a', repo_name: 'x', viewed_at: null, labels: [] },
      { repo_owner: 'b', repo_name: 'y', viewed_at: null, labels: [] },
    ] as any)

    await orchestrator.refreshPrCounts()
    const before = get(reviewRequestCount)
    activeResolvedRepo.set('a/x') // simulate switching to a specific repo
    expect(get(reviewRequestCount)).toBe(before)
    activeResolvedRepo.set('b/y')
    expect(get(reviewRequestCount)).toBe(before)
  })

  it('derives the active-repo count as unopened reviews scoped to the resolved repo', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) =>
      key === 'resolved_repo' ? 'visible/repo' : null,
    )
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null, labels: [] }, // counts
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: 5, labels: [] }, // opened — excluded
      { repo_owner: 'other', repo_name: 'repo', viewed_at: null, labels: [] }, // different repo
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(activeResolvedRepo)).toBe('visible/repo')
    expect(get(activeRepoReviewRequestCount)).toBe(1)
  })

  it('excludes DO NOT REVIEW labeled PRs from both counts', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) =>
      key === 'resolved_repo' ? 'visible/repo' : null,
    )
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null, labels: [] },
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null, labels: [{ name: 'DO NOT REVIEW', color: '' }] },
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(reviewRequestCount)).toBe(1)
    expect(get(activeRepoReviewRequestCount)).toBe(1)
  })

  it("resolves every project's repo so the sidebar shows a per-project review count", async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-web')
    projects.set([
      { id: 'proj-web', name: 'Web', path: '/web', created_at: 0, updated_at: 0 },
      { id: 'proj-api', name: 'API', path: '/api', created_at: 0, updated_at: 0 },
    ])
    vi.mocked(getProjectConfig).mockImplementation(async (projectId: string, key: string) => {
      if (key !== 'resolved_repo') return null
      if (projectId === 'proj-web') return 'acme/web'
      if (projectId === 'proj-api') return 'acme/api'
      return null
    })
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'acme', repo_name: 'web', viewed_at: null, labels: [] },
      { repo_owner: 'acme', repo_name: 'web', viewed_at: null, labels: [] },
      { repo_owner: 'acme', repo_name: 'api', viewed_at: null, labels: [] },
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(projectResolvedRepos).get('proj-web')).toBe('acme/web')
    expect(get(projectResolvedRepos).get('proj-api')).toBe('acme/api')
    const counts = get(reviewRequestCountByProject)
    expect(counts.get('proj-web')).toBe(2)
    expect(counts.get('proj-api')).toBe(1)
  })

  it('computes the per-project green-dot count from backend-authoritative rows', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    const row: TaskAttentionRow = {
      task_id: 'T-focus',
      project_id: 'P-1',
      project_name: 'Frontend',
      title: 'Focus task',
      state: 'agent-done',
      reason: 'Agent completed — review the changes.',
      activity_at: 10,
    }
    vi.mocked(getTaskAttention).mockResolvedValue([row])

    await orchestrator.refreshAttentionCounts()

    expect(get(taskAttentionRows)).toEqual([row])
    expect(get(taskAttentionLoaded)).toBe(true)
    expect(get(attentionCountByProject).get('P-1')).toBe(1)
  })

  it('does not treat a failed initial Task attention fetch as a loaded empty projection', async () => {
    const logError = vi.fn()
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn(), logError })
    vi.mocked(getTaskAttention).mockRejectedValue(new Error('attention unavailable'))

    await orchestrator.refreshAttentionCounts()

    expect(get(taskAttentionLoaded)).toBe(false)
    expect(get(taskAttentionRows)).toEqual([])
    expect(logError).toHaveBeenCalledOnce()
  })

  it('ignores an older Task attention response that finishes after a newer refresh', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    const older = deferred<TaskAttentionRow[]>()
    const newer = deferred<TaskAttentionRow[]>()
    const olderRow: TaskAttentionRow = {
      task_id: 'T-old', project_id: 'P-1', project_name: 'Frontend', title: 'Old',
      state: 'idle', reason: 'Old reason', activity_at: 1,
    }
    const newerRow: TaskAttentionRow = {
      task_id: 'T-new', project_id: 'P-2', project_name: 'Backend', title: 'New',
      state: 'failed', reason: 'New reason', activity_at: 2,
    }
    vi.mocked(getTaskAttention)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const olderRefresh = orchestrator.refreshAttentionCounts()
    const newerRefresh = orchestrator.refreshAttentionCounts()
    newer.resolve([newerRow])
    await newerRefresh
    older.resolve([olderRow])
    await olderRefresh

    expect(get(taskAttentionRows)).toEqual([newerRow])
    expect(get(attentionCountByProject)).toEqual(new Map([['P-2', 1]]))
  })

  it('coalesces concurrent project attention loads through the orchestrator owner', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    let resolveAttention: ((value: ProjectAttention[]) => void) | undefined
    vi.mocked(getProjectAttention).mockImplementationOnce(() => new Promise((resolve) => {
      resolveAttention = resolve
    }))

    const firstLoad = orchestrator.loadProjectAttention()
    const secondLoad = orchestrator.loadProjectAttention()

    expect(getProjectAttention).toHaveBeenCalledOnce()

    resolveAttention?.([
      { project_id: 'P-1', needs_input: 1, running_agents: 0, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 },
    ])
    await Promise.all([firstLoad, secondLoad])

    expect(get(projectAttention).get('P-1')?.needs_input).toBe(1)
  })

  it('throttles attention refreshes so a steady stream of triggers cannot starve the update', async () => {
    vi.useFakeTimers()
    try {
      const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })

      await orchestrator.loadProjectAttention() // schedules the refresh ~500ms out
      await vi.advanceTimersByTimeAsync(300)
      await orchestrator.loadProjectAttention() // must NOT reset the pending deadline
      await vi.advanceTimersByTimeAsync(200) // reaches the original ~500ms deadline

      // A resetting debounce would have pushed the fetch out to ~800ms and fired zero times here.
      expect(getTaskAttention).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('guards GitHub sync so concurrent calls do not duplicate IPC syncs', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    let resolveSync: (() => void) | undefined
    vi.mocked(forceGithubSync).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSync = () => resolve({} as any)
    }))

    const firstSync = orchestrator.triggerGithubSync()
    await orchestrator.triggerGithubSync()
    resolveSync?.()
    await firstSync

    expect(forceGithubSync).toHaveBeenCalledOnce()
  })
})
