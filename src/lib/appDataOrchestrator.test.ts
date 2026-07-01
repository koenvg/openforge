import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { PullRequestInfo } from './types'

vi.mock('./ipc', () => ({
  forceGithubSync: vi.fn(),
  getAuthoredPrs: vi.fn(),
  getConfig: vi.fn(),
  getLatestSessions: vi.fn(),
  getProjectAttention: vi.fn(),
  getProjectConfig: vi.fn(),
  getProjects: vi.fn(),
  getPullRequests: vi.fn(),
  getReviewPrs: vi.fn(),
  getTasksForProject: vi.fn(),
}))

import { useAppDataOrchestrator } from './appDataOrchestrator.svelte'
import {
  activeProjectId,
  activeSessions,
  authoredPrCount,
  error,
  isLoading,
  projectAttention,
  projects,
  reviewRequestCount,
  tasks,
  ticketPrs,
} from './stores'
import {
  forceGithubSync,
  getAuthoredPrs,
  getConfig,
  getLatestSessions,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPullRequests,
  getReviewPrs,
  getTasksForProject,
} from './ipc'

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
    activeSessions.set(new Map())
    authoredPrCount.set(0)
    error.set(null)
    isLoading.set(false)
    projectAttention.set(new Map())
    projects.set([])
    reviewRequestCount.set(0)
    tasks.set([])
    ticketPrs.set(new Map())

    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(getLatestSessions).mockResolvedValue([])
    vi.mocked(getProjectAttention).mockResolvedValue([])
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getProjects).mockResolvedValue([])
    vi.mocked(getPullRequests).mockResolvedValue([])
    vi.mocked(getReviewPrs).mockResolvedValue([])
    vi.mocked(getAuthoredPrs).mockResolvedValue([])
    vi.mocked(getTasksForProject).mockResolvedValue([])
    vi.mocked(forceGithubSync).mockResolvedValue({} as any)
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

  it('refreshes PR counts after applying project repo exclusions', async () => {
    const orchestrator = useAppDataOrchestrator({ setShowProjectSetup: vi.fn() })
    activeProjectId.set('proj-1')
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['hidden/repo']))
    vi.mocked(getReviewPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', viewed_at: null },
      { repo_owner: 'hidden', repo_name: 'repo', viewed_at: null },
      { repo_owner: 'visible', repo_name: 'seen', viewed_at: 123 },
    ] as any)
    vi.mocked(getAuthoredPrs).mockResolvedValue([
      { repo_owner: 'visible', repo_name: 'repo', ci_status: 'failure', review_status: null, state: 'open', mergeable: true, mergeable_state: 'clean' },
      { repo_owner: 'hidden', repo_name: 'repo', ci_status: 'failure', review_status: null, state: 'open', mergeable: true, mergeable_state: 'clean' },
      { repo_owner: 'visible', repo_name: 'changes', ci_status: 'success', review_status: 'changes_requested', state: 'open', mergeable: true, mergeable_state: 'clean' },
    ] as any)

    await orchestrator.refreshPrCounts()

    expect(get(reviewRequestCount)).toBe(1)
    expect(get(authoredPrCount)).toBe(2)
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
