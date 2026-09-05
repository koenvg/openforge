import { describe, it, expect } from 'vitest'
import type { PullRequestInfo } from './types'
import { getBoardStatusPresentation, getTaskReasonText, TASK_STATE_LABELS, getTaskListItemPresentation } from './taskStatePresentation'

function makePr(overrides: Partial<PullRequestInfo> & { id: number }): PullRequestInfo {
  return {
    ticket_id: 'T-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
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
    pr_number: overrides.id,
    ...overrides,
  }
}

describe('getBoardStatusPresentation', () => {
  it.each([
    ['doing', 'In Progress', 'status-running'],
    ['done', 'Done', 'status-success'],
    ['backlog', 'Backlog', 'status-neutral'],
    [null, 'Unknown', 'status-neutral'],
  ] as const)('maps %s to its domain status presentation', (status, label, badgeVariant) => {
    expect(getBoardStatusPresentation(status)).toEqual({ label, badgeVariant })
  })
})

describe('getTaskListItemPresentation', () => {
  it('overrides the compact badge and reason while a merge is in progress', () => {
    expect(getTaskListItemPresentation('ready-to-merge', 'Ready to merge — all checks passed.', true)).toEqual({
      badgeVariant: 'info',
      stateLabel: 'Merging...',
      reasonText: 'Pull request merge is in progress.',
    })
  })

  it('uses the task state compact label and reason when no merge is in progress', () => {
    expect(getTaskListItemPresentation('ready-to-merge', 'Ready to merge — all checks passed.', false)).toEqual({
      badgeVariant: 'info',
      stateLabel: 'Ready to Merge',
      reasonText: 'Ready to merge — all checks passed.',
    })
  })

  it('provides semantic badge variants for task states', () => {
    expect(getTaskListItemPresentation('active', '', false).badgeVariant).toBe('success')
    expect(getTaskListItemPresentation('needs-input', '', false).badgeVariant).toBe('warning')
    expect(getTaskListItemPresentation('failed', '', false).badgeVariant).toBe('danger')
    expect(getTaskListItemPresentation('ready-to-merge', '', false).badgeVariant).toBe('info')
    expect(getTaskListItemPresentation('backlog', '', false).badgeVariant).toBe('neutral')
  })
})

describe('getTaskReasonText', () => {
  it('uses Backlog as the business-friendly backlog label', () => {
    expect(TASK_STATE_LABELS.backlog).toBe('Backlog')
  })

  describe('TaskState mappings', () => {
    it('returns "In backlog — not started yet." for backlog state', () => {
      const reason = getTaskReasonText('backlog', [])
      expect(reason).toBe('In backlog — not started yet.')
    })

    it('returns "No agent running. Start when ready." for idle state', () => {
      const reason = getTaskReasonText('idle', [])
      expect(reason).toBe('No agent running. Start when ready.')
    })

    it('returns "Agent is running — no action needed right now." for active state', () => {
      const reason = getTaskReasonText('active', [])
      expect(reason).toBe('Agent is running — no action needed right now.')
    })

    it('returns "Agent needs your input to continue." for needs-input state', () => {
      const reason = getTaskReasonText('needs-input', [])
      expect(reason).toBe('Agent needs your input to continue.')
    })

    it('returns "Agent paused." for paused state', () => {
      const reason = getTaskReasonText('paused', [])
      expect(reason).toBe('Agent paused.')
    })

    it('returns "Agent completed — review the changes." for agent-done state', () => {
      const reason = getTaskReasonText('agent-done', [])
      expect(reason).toBe('Agent completed — review the changes.')
    })

    it('returns "Agent failed — check the error log." for failed state', () => {
      const reason = getTaskReasonText('failed', [])
      expect(reason).toBe('Agent failed — check the error log.')
    })

    it('returns "Agent was interrupted." for interrupted state', () => {
      const reason = getTaskReasonText('interrupted', [])
      expect(reason).toBe('Agent was interrupted.')
    })

    it('returns "Completed." for done state', () => {
      const reason = getTaskReasonText('done', [])
      expect(reason).toBe('Completed.')
    })

    it('returns "Pull request is a draft." for pr-draft state', () => {
      const pr = makePr({ id: 1, draft: true })
      const reason = getTaskReasonText('pr-draft', [pr])
      expect(reason).toBe('Pull request is a draft.')
    })

    it('returns "Pull request is open — awaiting review." for pr-open state', () => {
      const pr = makePr({ id: 1, state: 'open' })
      const reason = getTaskReasonText('pr-open', [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('returns "CI pipeline is running." for ci-running state', () => {
      const pr = makePr({ id: 1, ci_status: 'pending' })
      const reason = getTaskReasonText('ci-running', [pr])
      expect(reason).toBe('CI pipeline is running.')
    })

    it('returns "Waiting on code review." for review-pending state', () => {
      const pr = makePr({ id: 1, review_status: 'review_required' })
      const reason = getTaskReasonText('review-pending', [pr])
      expect(reason).toBe('Waiting on code review.')
    })

    it('returns "CI pipeline failed — check the logs." for ci-failed state', () => {
      const pr = makePr({ id: 1, ci_status: 'failure' })
      const reason = getTaskReasonText('ci-failed', [pr])
      expect(reason).toBe('CI pipeline failed — check the logs.')
    })

    it('returns "Changes requested on the pull request." for changes-requested state', () => {
      const pr = makePr({ id: 1, review_status: 'changes_requested' })
      const reason = getTaskReasonText('changes-requested', [pr])
      expect(reason).toBe('Changes requested on the pull request.')
    })

    it('returns "Ready to merge — all checks passed." for ready-to-merge state', () => {
      const pr = makePr({ id: 1, ci_status: 'success', review_status: 'approved' })
      const reason = getTaskReasonText('ready-to-merge', [pr])
      expect(reason).toBe('Ready to merge — all checks passed.')
    })

    it('returns "Ready to enqueue — all requirements passed." for ready-to-enqueue state', () => {
      const pr = makePr({ id: 1, merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue' })
      const reason = getTaskReasonText('ready-to-enqueue', [pr])
      expect(reason).toBe('Ready to enqueue — all requirements passed.')
    })

    it('returns "Pull request is queued for merge." for pr-queued state', () => {
      const pr = makePr({ id: 1, is_queued: true })
      const reason = getTaskReasonText('pr-queued', [pr])
      expect(reason).toBe('Pull request is queued for merge.')
    })

    it('keeps merged and closed PR task labels distinct', () => {
      expect(TASK_STATE_LABELS['pr-merged']).toBe('PR Merged')
      expect((TASK_STATE_LABELS as Record<string, string>)['pr-closed']).toBe('PR Closed')
    })

    it('returns "Pull request merged." for pr-merged state', () => {
      const pr = makePr({ id: 1, state: 'merged' })
      const reason = getTaskReasonText('pr-merged', [pr])
      expect(reason).toBe('Pull request merged.')
    })

    it('returns "Pull request closed without merge." for pr-closed state', () => {
      const pr = makePr({ id: 1, state: 'closed', merged_at: null })
      const reason = getTaskReasonText('pr-closed' as never, [pr])
      expect(reason).toBe('Pull request closed without merge.')
    })

    it('returns "Pull request has merge conflicts that must be resolved." for merge-conflict state', () => {
      const pr = makePr({ id: 1, mergeable_state: 'dirty' })
      const reason = getTaskReasonText('merge-conflict', [pr])
      expect(reason).toBe('Pull request has merge conflicts that must be resolved.')
    })
  })

  describe('State-driven PR reason text', () => {
    it('does not prepend when unaddressed_comment_count is 0', () => {
      const pr = makePr({ id: 1, unaddressed_comment_count: 0 })
      const reason = getTaskReasonText('pr-open', [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('handles undefined unaddressed_comment_count as 0', () => {
      const pr = makePr({ id: 1 })
      Object.defineProperty(pr, 'unaddressed_comment_count', { value: undefined })
      const reason = getTaskReasonText('pr-open', [pr])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })

    it('does not surface comments from a different PR than the state-driving PR', () => {
      const firstOpen = makePr({ id: 1, unaddressed_comment_count: 0 })
      const laterOpen = makePr({ id: 2, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText('pr-open', [firstOpen, laterOpen])
      expect(reason).toBe('Pull request is open — awaiting review.')
    })
  })

  describe('getTaskReasonText - unaddressed-comments state', () => {
    it('returns reason text for unaddressed-comments state with no PRs', () => {
      const reason = getTaskReasonText('unaddressed-comments', [])
      expect(reason).toBeTruthy()
      expect(typeof reason).toBe('string')
      expect(reason).not.toBe('Status: unaddressed-comments')
    })

    it('does not double-count when state is unaddressed-comments and PR has comments', () => {
      const pr = makePr({ id: 1, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText('unaddressed-comments', [pr])
      const countMatches = (reason.match(/3/g) ?? []).length
      expect(countMatches).toBeLessThanOrEqual(1)
    })

    it('uses the state-driving PR count instead of summing all PR comments', () => {
      const mergedPr = makePr({ id: 1, state: 'merged', merged_at: 2000, unaddressed_comment_count: 5 })
      const openPr = makePr({ id: 2, state: 'open', unaddressed_comment_count: 3 })
      const reason = getTaskReasonText('unaddressed-comments', [mergedPr, openPr])
      expect(reason).toBe('3 unaddressed comment(s) on the pull request.')
    })

    it('does not prepend unaddressed count for non-unaddressed-comments states', () => {
      const pr = makePr({ id: 1, unaddressed_comment_count: 3 })
      const reason = getTaskReasonText('ci-failed', [pr])
      expect(reason).toBe('CI pipeline failed — check the logs.')
    })
  })
})
