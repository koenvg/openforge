import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ProjectAttention, PullRequestInfo } from './types'

vi.mock('./ipc', () => ({
  forceGithubSync: vi.fn(),
  getAllTasks: vi.fn(),
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
import type { AgentSession, Task } from './types'
import {
  activeProjectId,
  activeResolvedRepo,
  activeSessions,
  attentionCountByProject,
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
  getAllTasks,
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
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: projectId,
    created_at: 1000,
    updated_at: 1000,
  }
}

function makeSession(ticketId: string, status: string): AgentSession {
  return {
    id: `s-${ticketId}`,
    ticket_id: ticketId,
    opencode_session_id: null,
    stage: 'implement',
    status,
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    pi_session_id: null,
  }
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
    attentionCountByProject.set(new Map())
    projectResolvedRepos.set(new Map())
    projects.set([])
    reviewPrs.set([])
    dependencyReferenceTasks.set([])
    tasks.set([])
    ticketPrs.set(new Map())

    vi.mocked(getAllTasks).mockResolvedValue([])
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

  it('computes the per-project green-dot count with the board\'s focus semantics', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    projects.set([{ id: 'P-1', name: 'Frontend', path: '/fe', created_at: 0, updated_at: 0 }])
    // Three doing tasks: one running (in-flight), one Out of Focus, one plain agent-done.
    vi.mocked(getAllTasks).mockResolvedValue([
      makeTask('T-run', 'P-1'),
      makeTask('T-out', 'P-1'),
      makeTask('T-focus', 'P-1'),
    ])
    vi.mocked(getLatestSessions).mockResolvedValue([
      makeSession('T-run', 'running'),
      makeSession('T-out', 'completed'),
      makeSession('T-focus', 'completed'),
    ])
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) =>
      key === 'low_fire_task_ids' ? JSON.stringify(['T-out']) : null,
    )

    await orchestrator.refreshAttentionCounts()

    // In-flight (T-run) and Out of Focus (T-out) are excluded — only T-focus needs attention.
    expect(get(attentionCountByProject).get('P-1')).toBe(1)
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
      expect(getAllTasks).toHaveBeenCalledTimes(1)
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
