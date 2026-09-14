import { describe, expect, it, vi } from 'vitest'
import type { AgentReviewComment } from '../../lib/prReviewRecords'
import {
  agentCommentToSubmission,
  approvedInlineAgentComments,
  dismissSubmittedAgentComments,
} from './agentCommentSubmission'

function agentComment(overrides: Partial<AgentReviewComment> = {}): AgentReviewComment {
  return {
    id: 100,
    review_pr_id: 7,
    review_session_key: 'session-1',
    comment_type: 'inline',
    file_path: 'src/main.ts',
    line_number: 20,
    side: 'RIGHT',
    body: 'Consider error handling here',
    status: 'pending',
    opencode_session_id: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    ...overrides,
  }
}

describe('approvedInlineAgentComments', () => {
  it('keeps only approved inline comments that can be anchored to a line', () => {
    const comments = [
      agentComment({ id: 1, status: 'approved' }),
      agentComment({ id: 2, status: 'pending' }),
      agentComment({ id: 3, status: 'dismissed' }),
      agentComment({ id: 4, status: 'approved', comment_type: 'summary' }),
      agentComment({ id: 5, status: 'approved', line_number: null }),
    ]

    expect(approvedInlineAgentComments(comments).map(comment => comment.id)).toEqual([1])
  })
})

describe('agentCommentToSubmission', () => {
  it('maps an agent comment to a review submission comment', () => {
    expect(agentCommentToSubmission(agentComment({ file_path: 'src/a.ts', line_number: 42, side: 'LEFT', body: '  trim me  ' })))
      .toEqual({ path: 'src/a.ts', line: 42, side: 'LEFT', body: 'trim me' })
  })

  it('defaults a missing side to RIGHT', () => {
    expect(agentCommentToSubmission(agentComment({ side: null })).side).toBe('RIGHT')
  })
})

describe('dismissSubmittedAgentComments', () => {
  it('dismisses the comments the review just posted and leaves the rest alone', async () => {
    const comments = [
      agentComment({ id: 1, status: 'approved' }),
      agentComment({ id: 2, status: 'pending' }),
      agentComment({ id: 3, status: 'approved', comment_type: 'summary' }),
    ]
    const updateStatus = vi.fn().mockResolvedValue(undefined)
    const onAgentCommentsChange = vi.fn()

    await dismissSubmittedAgentComments(comments, updateStatus, onAgentCommentsChange)

    expect(updateStatus.mock.calls).toEqual([[1, 'dismissed']])
    expect(onAgentCommentsChange).toHaveBeenCalledWith([
      { ...comments[0], status: 'dismissed' },
      comments[1],
      comments[2],
    ])
  })

  it('does nothing when the review posted no agent comments', async () => {
    const updateStatus = vi.fn()
    const onAgentCommentsChange = vi.fn()

    await dismissSubmittedAgentComments([agentComment({ status: 'pending' })], updateStatus, onAgentCommentsChange)

    expect(updateStatus).not.toHaveBeenCalled()
    expect(onAgentCommentsChange).not.toHaveBeenCalled()
  })

  it('reports a failed status write to the caller', async () => {
    const updateStatus = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(dismissSubmittedAgentComments([agentComment({ status: 'approved' })], updateStatus, vi.fn()))
      .rejects.toThrow('offline')
  })
})
