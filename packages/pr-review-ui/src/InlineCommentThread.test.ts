import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { AgentReviewComment, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { ComponentProps } from 'svelte'
import type { AgentCommentDisplayData, CommentDisplayData } from './diffComments'
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


function makeAgentDisplayComment(comment: AgentReviewComment): AgentCommentDisplayData {
  if (!comment.file_path || comment.line_number === null) {
    throw new Error('Agent display comments require an inline location')
  }

  return {
    body: comment.body,
    type: 'agent',
    commentId: comment.id,
    status: comment.status,
    filePath: comment.file_path,
    lineNumber: comment.line_number,
    commentSide: comment.side === 'LEFT' ? 'LEFT' : 'RIGHT',
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
  it('keeps icon-only actions named while hiding their icons from assistive technology', () => {
    const agentComment = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [
        makeAgentDisplayComment(agentComment),
        { body: 'Pending suggestion', type: 'pending', index: 0 },
      ],
    }
    const setup = makeProps({
      data,
      agentComments: [agentComment],
      pendingComments: [{ path: 'src/example.ts', line: 12, side: 'RIGHT', body: 'Pending suggestion' }],
    })
    render(InlineCommentThread, { props: setup.props })

    const actionNames = [
      'Approve AI review comment',
      'Dismiss AI review comment',
      'Remove pending comment',
    ]
    for (const name of actionNames) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('labels replies with text while hiding the decorative reply icon', () => {
    const data: CommentDisplayData = {
      comments: [{
        body: 'Existing reply',
        type: 'existing',
        author: 'reviewer',
        createdAt: '2024-01-01T00:00:00Z',
        isReply: true,
      }],
    }
    const setup = makeProps({ data })
    render(InlineCommentThread, { props: setup.props })

    const replyLabel = screen.getByText('reply')
    expect(replyLabel.textContent?.trim()).toBe('reply')
    expect(replyLabel.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
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

  it('approves an AI comment in place without copying it to the pending list', async () => {
    const statusUpdate = makeDeferred()
    const initialAgent = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [makeAgentDisplayComment(initialAgent)],
    }
    const setup = makeProps({
      data,
      agentComments: [initialAgent],
      onUpdateAgentCommentStatus: vi.fn(() => statusUpdate.promise),
    })
    const { rerender } = render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', {
      name: 'Approve AI review comment',
    }))

    expect(setup.props.onUpdateAgentCommentStatus).toHaveBeenCalledWith(initialAgent.id, 'approved')
    expect(setup.onAgentCommentsChange).not.toHaveBeenCalled()

    const latestAgentComments = [
      { ...initialAgent, body: 'Updated while approving', updated_at: 2 },
      makeAgentComment({ id: 8, body: 'Another AI comment' }),
    ]
    await rerender({ ...setup.props, agentComments: latestAgentComments })

    statusUpdate.resolve()

    await waitFor(() => {
      expect(setup.onAgentCommentsChange).toHaveBeenCalledOnce()
      expect(setup.onAgentCommentsChange).toHaveBeenCalledWith([
        { ...latestAgentComments[0], status: 'approved' },
        latestAgentComments[1],
      ])
    })
    // Approval must NOT create a duplicate pending comment — that was the bug.
    expect(setup.onPendingCommentsChange).not.toHaveBeenCalled()
  })

  it('un-approves an approved AI comment back to pending', async () => {
    const statusUpdate = makeDeferred()
    const initialAgent = makeAgentComment({ status: 'approved' })
    const data: CommentDisplayData = {
      comments: [makeAgentDisplayComment(initialAgent)],
    }
    const setup = makeProps({
      data,
      agentComments: [initialAgent],
      onUpdateAgentCommentStatus: vi.fn(() => statusUpdate.promise),
    })
    const { rerender } = render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Un-approve AI review comment' }))

    expect(setup.props.onUpdateAgentCommentStatus).toHaveBeenCalledWith(initialAgent.id, 'pending')
    expect(setup.onAgentCommentsChange).not.toHaveBeenCalled()

    const latestAgentComments = [
      { ...initialAgent, body: 'Updated while un-approving', updated_at: 2 },
      makeAgentComment({ id: 8, body: 'Another AI comment' }),
    ]
    await rerender({ ...setup.props, agentComments: latestAgentComments })

    statusUpdate.resolve()

    await waitFor(() => {
      expect(setup.onAgentCommentsChange).toHaveBeenCalledOnce()
      expect(setup.onAgentCommentsChange).toHaveBeenCalledWith([
        { ...latestAgentComments[0], status: 'pending' },
        latestAgentComments[1],
      ])
    })
    expect(setup.onPendingCommentsChange).not.toHaveBeenCalled()
  })

  it('dismisses an AI comment using updated props after the status callback resolves', async () => {
    const statusUpdate = makeDeferred()
    const initialAgent = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [makeAgentDisplayComment(initialAgent)],
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
  it('queues a trimmed reply to an existing GitHub comment and closes the editor', async () => {
    const onAddReplyToReview = vi.fn()
    const data: CommentDisplayData = {
      comments: [{
        body: 'Existing review comment',
        type: 'existing',
        author: 'reviewer',
        createdAt: '2024-01-01T00:00:00Z',
        isReply: false,
        commentId: 23,
      }],
    }
    const setup = makeProps({ data, onReplyToExistingComment: vi.fn(), onAddReplyToReview })
    render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Reply to this comment' }))
    const editor = screen.getByRole('textbox', { name: 'Reply to this comment' })
    await fireEvent.input(editor, { target: { value: '  Hold this reply  ' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))

    expect(onAddReplyToReview).toHaveBeenCalledWith(23, 'Hold this reply')
    expect(screen.queryByRole('textbox', { name: 'Reply to this comment' })).toBeNull()
  })

  it('asks about an AI review comment with its diff location', async () => {
    const onAskAboutComment = vi.fn()
    const agentComment = makeAgentComment()
    const data: CommentDisplayData = {
      comments: [makeAgentDisplayComment(agentComment)],
    }
    const setup = makeProps({ data, agentComments: [agentComment], onAskAboutComment })
    render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Ask the agent about this AI review comment' }))
    const editor = screen.getByRole('textbox', { name: 'Ask the agent about this AI review comment' })
    await fireEvent.input(editor, { target: { value: '  Why this change?  ' } })
    await fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onAskAboutComment).toHaveBeenCalledWith({
      commentId: agentComment.id,
      filename: 'src/example.ts',
      line: 12,
      side: 'RIGHT',
      body: 'Why this change?',
    })
    expect(screen.queryByRole('textbox', { name: 'Ask the agent about this AI review comment' })).toBeNull()
  })

  it('replies to an answered AI Q&A thread', async () => {
    const onReplyToThread = vi.fn()
    const data: CommentDisplayData = {
      comments: [{
        type: 'ai-thread',
        isReply: false,
        thread: {
          id: 'thread-1',
          anchor: { type: 'line', filename: 'src/example.ts', line: 12, side: 'RIGHT' },
          status: 'answered',
          messages: [{ role: 'user', body: 'Why?', created_at: 1 }],
          created_at: 1,
          updated_at: 1,
        },
      }],
    }
    const setup = makeProps({ data, onReplyToThread })
    render(InlineCommentThread, { props: setup.props })

    const editor = screen.getByRole('textbox', { name: 'Reply to the AI author' })
    await fireEvent.input(editor, { target: { value: '  One more question  ' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'One more question')
    expect((editor as HTMLInputElement).value).toBe('')
  })

})
