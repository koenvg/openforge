import { describe, expect, it } from 'vitest'
import { getPullRequestMergeMethodSelections, selectPullRequestForAction } from './pullRequestActionPolicy'
import type { PullRequestInfo } from './types'

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
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
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
    allowed_merge_methods: ['merge'],
    default_merge_method: 'merge',
    ...overrides,
  }
}

describe('selectPullRequestForAction', () => {
  it('selects the only pull request eligible for the requested action', () => {
    const mergePullRequest = createPullRequest({ id: 1 })
    const enqueuePullRequest = createPullRequest({
      id: 2,
      head_sha: 'def',
      merge_readiness_status: 'ready_to_enqueue',
      merge_readiness_action: 'enqueue',
      readiness_source_head_sha: 'def',
      readiness_updated_at: 0,
    })

    expect(selectPullRequestForAction([mergePullRequest, enqueuePullRequest], 'merge')).toEqual({
      status: 'eligible',
      pullRequest: mergePullRequest,
    })

    expect(selectPullRequestForAction([mergePullRequest, enqueuePullRequest], 'enqueue')).toEqual({
      status: 'eligible',
      pullRequest: enqueuePullRequest,
    })
  })

  it('distinguishes unavailable actions from ambiguous actions', () => {
    const readyPullRequest = createPullRequest()

    expect(selectPullRequestForAction([], 'merge')).toEqual({ status: 'unavailable' })
    const ambiguousSelection = selectPullRequestForAction([readyPullRequest, createPullRequest({ id: 43 })], 'merge')
    expect(ambiguousSelection).toEqual({ status: 'ambiguous' })
  })
})

describe('getPullRequestMergeMethodSelections', () => {
  it('returns unique allowed methods with the configured default first', () => {
    const pullRequest = createPullRequest({
      allowed_merge_methods: '["merge","squash","squash","invalid","rebase"]',
      default_merge_method: 'squash',
    })

    expect(getPullRequestMergeMethodSelections(pullRequest)).toEqual([
      { mergeMethod: 'squash', isDefault: true },
      { mergeMethod: 'merge', isDefault: false },
      { mergeMethod: 'rebase', isDefault: false },
    ])
  })

  it('returns no methods when repository merge policy is unknown or malformed', () => {
    expect(getPullRequestMergeMethodSelections(createPullRequest({ merge_methods_policy_known: false }))).toEqual([])
    expect(getPullRequestMergeMethodSelections(createPullRequest({ allowed_merge_methods: 'not-json' }))).toEqual([])
  })
})
