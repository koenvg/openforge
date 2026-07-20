import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { AgentReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { ComponentProps } from 'svelte'
import type { CommentDisplayData } from './diffComments'
import InlineCommentThread from './InlineCommentThread.svelte'

type InlineCommentThreadProps = ComponentProps<typeof InlineCommentThread>

function makeAgentComment(overrides: Partial<AgentReviewComment> = {}): AgentReviewComment {
  return {
    id: 7,
    review_pr_id: 42,
    review_session_key: 'review-session',
    comment_type: 'inline',
    file_path: 'src/example.ts',
    line_number: 12,
    side: 'RIGHT',
    body: 'AI suggestion',
    status: 'pending',
    opencode_session_id: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function makeDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeProps(overrides: Partial<InlineCommentThreadProps> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onAgentCommentsChange = vi.fn()
  const onUpdateAgentCommentStatus = vi.fn().mockResolvedValue(undefined)
  const props: InlineCommentThreadProps = {
    data: { comments: [] },
    filename: 'src/example.ts',
    pendingComments: [],
    agentComments: [],
    onPendingCommentsChange,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    ...overrides,
  }

  return { props, onPendingCommentsChange, onAgentCommentsChange, onUpdateAgentCommentStatus }
}

describe('InlineCommentThread', () => {
  it('removes the selected pending comment by its source-array index', async () => {
    const pendingComments: ReviewSubmissionComment[] = [
      { path: 'src/first.ts', line: 4, side: 'RIGHT', body: 'First pending comment' },
      { path: 'src/example.ts', line: 12, side: 'RIGHT', body: 'Selected pending comment' },
      { path: 'src/last.ts', line: 20, side: 'LEFT', body: 'Last pending comment' },
    ]
    const data: CommentDisplayData = {
      comments: [{ body: 'Selected pending comment', type: 'pending', index: 1 }],
    }
    const setup = makeProps({ data, pendingComments })
    render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Remove pending comment' }))

    expect(setup.onPendingCommentsChange).toHaveBeenCalledOnce()
    expect(setup.onPendingCommentsChange).toHaveBeenCalledWith([
      pendingComments[0],
      pendingComments[2],
    ])
    expect(setup.onAgentCommentsChange).not.toHaveBeenCalled()
  })

  it('approves an AI comment using updated props after the status callback resolves', async () => {
    const statusUpdate = makeDeferred()
    const initialAgent = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [{
        body: 'AI suggestion',
        type: 'agent',
        commentId: initialAgent.id,
        status: initialAgent.status,
        filePath: initialAgent.file_path ?? undefined,
        lineNumber: initialAgent.line_number ?? undefined,
        commentSide: initialAgent.side ?? undefined,
      }],
    }
    const setup = makeProps({
      data,
      agentComments: [initialAgent],
      onUpdateAgentCommentStatus: vi.fn(() => statusUpdate.promise),
    })
    const { rerender } = render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', {
      name: 'Approve AI review comment and add to pending comments',
    }))

    expect(setup.props.onUpdateAgentCommentStatus).toHaveBeenCalledWith(initialAgent.id, 'approved')
    expect(setup.onPendingCommentsChange).not.toHaveBeenCalled()
    expect(setup.onAgentCommentsChange).not.toHaveBeenCalled()

    const latestPendingComments: ReviewSubmissionComment[] = [
      { path: 'src/existing.ts', line: 3, side: 'LEFT', body: 'Added while approving' },
    ]
    const latestAgentComments = [
      { ...initialAgent, body: 'Updated while approving', updated_at: 2 },
      makeAgentComment({ id: 8, body: 'Another AI comment' }),
    ]
    await rerender({
      ...setup.props,
      pendingComments: latestPendingComments,
      agentComments: latestAgentComments,
    })

    statusUpdate.resolve()

    await waitFor(() => {
      expect(setup.onPendingCommentsChange).toHaveBeenCalledOnce()
      expect(setup.onPendingCommentsChange).toHaveBeenCalledWith([
        ...latestPendingComments,
        {
          path: 'src/example.ts',
          line: 12,
          side: 'RIGHT',
          body: 'AI suggestion',
        },
      ])
      expect(setup.onAgentCommentsChange).toHaveBeenCalledOnce()
      expect(setup.onAgentCommentsChange).toHaveBeenCalledWith([
        { ...latestAgentComments[0], status: 'approved' },
        latestAgentComments[1],
      ])
    })
  })

  it('dismisses an AI comment using updated props after the status callback resolves', async () => {
    const statusUpdate = makeDeferred()
    const initialAgent = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [{
        body: initialAgent.body,
        type: 'agent',
        commentId: initialAgent.id,
        status: initialAgent.status,
      }],
    }
    const setup = makeProps({
      data,
      agentComments: [initialAgent],
      onUpdateAgentCommentStatus: vi.fn(() => statusUpdate.promise),
    })
    const { rerender } = render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss AI review comment' }))

    expect(setup.props.onUpdateAgentCommentStatus).toHaveBeenCalledWith(initialAgent.id, 'dismissed')
    expect(setup.onAgentCommentsChange).not.toHaveBeenCalled()

    const latestAgentComments = [
      makeAgentComment({ id: 8, body: 'Another AI comment' }),
      { ...initialAgent, body: 'Updated while dismissing', updated_at: 2 },
    ]
    await rerender({ ...setup.props, agentComments: latestAgentComments })

    statusUpdate.resolve()

    await waitFor(() => {
      expect(setup.onAgentCommentsChange).toHaveBeenCalledOnce()
      expect(setup.onAgentCommentsChange).toHaveBeenCalledWith([
        latestAgentComments[0],
        { ...latestAgentComments[1], status: 'dismissed' },
      ])
    })
    expect(setup.onPendingCommentsChange).not.toHaveBeenCalled()
  })
})
