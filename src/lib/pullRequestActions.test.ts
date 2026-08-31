import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { PullRequestInfo } from './types'
import { createTask } from '../App.test-fixtures/tasks'

vi.mock('./ipc', () => ({
  enqueuePullRequest: vi.fn(),
  mergePullRequest: vi.fn(),
  refreshTaskGithubStatus: vi.fn(),
}))

import { createPullRequestActions } from './pullRequestActions'
import { enqueuePullRequest, mergePullRequest, refreshTaskGithubStatus } from './ipc'
import { error, ticketPrs } from './stores'

const task = createTask({ id: 'T-42', projectId: 'proj-1', status: 'doing' })

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: task.id,
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
    merge_methods_policy_known: true,
    allowed_merge_methods: ['merge', 'squash', 'rebase'],
    default_merge_method: 'merge',
    ...overrides,
  }
}

function createActions() {
  return createPullRequestActions({ logError: vi.fn() })
}

describe('createPullRequestActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    error.set(null)
    ticketPrs.set(new Map())
  })

  it('does not merge and sets the exact disambiguation error when multiple PRs are ready', async () => {
    const actions = createActions()
    const firstReadyPr = createPullRequest({ id: 1, title: 'First ready PR', head_sha: 'abc' })
    const secondReadyPr = createPullRequest({ id: 2, title: 'Second ready PR', head_sha: 'def' })
    ticketPrs.set(new Map([[task.id, [firstReadyPr, secondReadyPr]]]))

    await actions.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([firstReadyPr, secondReadyPr])
    expect(get(error)).toBe('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
  })

  it('marks a single ready PR merged locally', async () => {
    const actions = createActions()
    const readyPr = createPullRequest({ id: 9001, pr_number: 42 })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(mergePullRequest).mockResolvedValue(undefined)

    await actions.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).toHaveBeenCalledWith(task.id, readyPr.id, readyPr.head_sha, 'squash')
    expect(get(ticketPrs).get(task.id)?.[0].state).toBe('merged')
    expect(get(ticketPrs).get(task.id)?.[0].merged_at).not.toBeNull()
  })

  it('rejects a merge method that is not allowed for the selected pull request', async () => {
    const actions = createActions()
    const readyPr = createPullRequest({ allowed_merge_methods: ['merge'] })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))

    await actions.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(error)).toBe('The selected merge method is not available for this pull request.')
  })

  it('refreshes GitHub policy after a rejected merge without trying another method', async () => {
    const actions = createActions()
    const readyPr = createPullRequest({ id: 9001, pr_number: 42 })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(mergePullRequest).mockRejectedValue(new Error('Merge commits are not allowed'))
    vi.mocked(refreshTaskGithubStatus).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
      outcome: 'completed',
    })

    await actions.mergeReadyPullRequest(task, 'merge')

    expect(mergePullRequest).toHaveBeenCalledOnce()
    expect(refreshTaskGithubStatus).toHaveBeenCalledWith(task.id)
    expect(get(error)).toContain('Merge commits are not allowed')
  })

  it('marks a single ready-to-enqueue PR queued locally', async () => {
    const actions = createActions()
    const readyPr = createPullRequest({
      id: 9002,
      pr_number: 43,
      merge_readiness_status: 'ready_to_enqueue',
      merge_readiness_action: 'enqueue',
      readiness_source_head_sha: 'abc',
      readiness_updated_at: 0,
      merge_queue_required: true,
    })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(enqueuePullRequest).mockResolvedValue(undefined)

    await actions.enqueueReadyPullRequest(task)

    expect(enqueuePullRequest).toHaveBeenCalledWith(task.id, readyPr.id, readyPr.head_sha)
    expect(get(ticketPrs).get(task.id)?.[0]).toEqual(expect.objectContaining({
      is_queued: true,
      merge_readiness_status: 'queued_pull_request',
      merge_readiness_action: 'wait_for_queue',
    }))
  })

  it('does not enqueue a stale ready-to-enqueue PR', async () => {
    const actions = createActions()
    const stalePr = createPullRequest({
      head_sha: 'new-head',
      mergeable: null,
      mergeable_state: 'unknown',
      merge_readiness_status: 'ready_to_enqueue',
      merge_readiness_action: 'enqueue',
      readiness_source_head_sha: 'old-head',
      readiness_updated_at: 1,
    })
    ticketPrs.set(new Map([[task.id, [stalePr]]]))

    await actions.enqueueReadyPullRequest(task)

    expect(enqueuePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([stalePr])
  })

  it.each([
    ['pending CI', { ci_status: 'pending', mergeable_state: 'clean' }],
    ['draft PR', { draft: true, mergeable_state: 'clean', ci_status: 'success' }],
    ['queued PR', { is_queued: true, mergeable_state: 'clean', ci_status: 'success' }],
    ['unknown mergeability', { mergeable: null, mergeable_state: 'unknown', ci_status: 'success' }],
    ['null mergeability', { mergeable: null, mergeable_state: null, ci_status: 'success' }],
  ] satisfies Array<[string, Partial<PullRequestInfo>]>)('does not merge a PR with %s', async (_label, overrides) => {
    const actions = createActions()
    const blockedPr = createPullRequest(overrides)
    ticketPrs.set(new Map([[task.id, [blockedPr]]]))

    await actions.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([blockedPr])
  })
})
