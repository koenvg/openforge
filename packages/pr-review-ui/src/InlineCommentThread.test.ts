import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import type { ComponentProps } from 'svelte'
import type { CommentDisplayData } from './diffComments'
import InlineCommentThread from './InlineCommentThread.svelte'

type InlineCommentThreadProps = ComponentProps<typeof InlineCommentThread>

function makeProps(overrides: Partial<InlineCommentThreadProps> = {}) {
  const onPendingCommentsChange = vi.fn()
  const props: InlineCommentThreadProps = {
    data: { comments: [] },
    pendingComments: [],
    onPendingCommentsChange,
    ...overrides,
  }

  return { props, onPendingCommentsChange }
}

describe('InlineCommentThread', () => {
  it('keeps icon-only actions named while hiding their icons from assistive technology', () => {
    const data: CommentDisplayData = {
      comments: [{ body: 'Pending suggestion', type: 'pending', index: 0 }],
    }
    const setup = makeProps({
      data,
      pendingComments: [{ path: 'src/example.ts', line: 12, side: 'RIGHT', body: 'Pending suggestion' }],
    })
    render(InlineCommentThread, { props: setup.props })

    const button = screen.getByRole('button', { name: 'Remove pending comment' })
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
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

    await fireEvent.click(screen.getByRole('button', { name: 'Reply to this comment on GitHub' }))
    const editor = screen.getByRole('textbox', { name: 'Reply to this comment' })
    await fireEvent.input(editor, { target: { value: '  Hold this reply  ' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))

    expect(onAddReplyToReview).toHaveBeenCalledWith(23, 'Hold this reply')
    expect(screen.queryByRole('textbox', { name: 'Reply to this comment' })).toBeNull()
  })

  it('keeps a rejected reply available to retry', async () => {
    const onReplyToExistingComment = vi.fn().mockRejectedValue(new Error('GitHub rejected it'))
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
    const setup = makeProps({ data, onReplyToExistingComment })
    render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Reply to this comment on GitHub' }))
    const editor = screen.getByRole('textbox', { name: 'Reply to this comment' })
    await fireEvent.input(editor, { target: { value: 'Please retry this' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Reply was not posted. Try again.')
    expect((editor as HTMLInputElement).value).toBe('Please retry this')

    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect(onReplyToExistingComment).toHaveBeenCalledTimes(2)
  })

  it('does not offer a reply action without an immediate reply callback', () => {
    const setup = makeProps({
      data: {
        comments: [{
          body: 'Existing review comment',
          type: 'existing',
          author: 'reviewer',
          createdAt: '2024-01-01T00:00:00Z',
          isReply: false,
          commentId: 23,
        }],
      },
    })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.queryByRole('button', { name: 'Reply to this comment on GitHub' })).toBeNull()
  })

  it('does not offer a reply action on a reply', () => {
    const setup = makeProps({
      data: {
        comments: [{
          body: 'Existing reply',
          type: 'existing',
          author: 'reviewer',
          createdAt: '2024-01-01T00:00:00Z',
          isReply: true,
        }],
      },
      onReplyToExistingComment: vi.fn(),
    })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.queryByRole('button', { name: 'Reply to this comment on GitHub' })).toBeNull()
  })
})

describe('InlineCommentThread review threads', () => {
  function makeReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
    return {
      id: 'rt_1',
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'sha-1',
      anchor: { kind: 'line', filePath: 'src/example.ts', line: 12, side: 'RIGHT' },
      origin: 'agent',
      status: 'open',
      awaiting: 'none',
      runId: null,
      idempotencyKey: null,
      seenAt: null,
      hasUnreadAgentMessage: false,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: 'rtm_1', role: 'agent', body: 'Needs a null check', createdAt: 1 },
        { id: 'rtm_2', role: 'human', body: 'Agreed', createdAt: 2 },
      ],
      ...overrides,
    }
  }

  function makeReviewThreadData(thread: ReviewThread): CommentDisplayData {
    return { comments: [{ type: 'thread', thread }] }
  }

  it('renders every message of a supplied thread', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread()) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Needs a null check')).toBeTruthy()
    expect(screen.getByText('Agreed')).toBeTruthy()
  })

  it('hides the reply editor when the embedding surface supplies no reply callback', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread()) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.queryByRole('textbox', { name: 'Reply to the review thread' })).toBeNull()
  })

  it('reports a reply to the embedding surface and clears the draft', async () => {
    const onReplyToThread = vi.fn()
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread()), onReplyToThread })
    render(InlineCommentThread, { props: setup.props })

    const editor = screen.getByRole('textbox', { name: 'Reply to the review thread' })
    await fireEvent.input(editor, { target: { value: '  Fixed in the next commit  ' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(onReplyToThread).toHaveBeenCalledWith('rt_1', 'Fixed in the next commit')
    expect((editor as HTMLInputElement).value).toBe('')
  })

  it('badges a plugin-authored thread as written by a plugin', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread({ origin: 'plugin' })) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Plugin')).toBeTruthy()
  })

  it('offers resolve and dismiss on an open thread', async () => {
    const onSetThreadStatus = vi.fn()
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread()), onSetThreadStatus })
    render(InlineCommentThread, { props: setup.props })

    await fireEvent.click(screen.getByRole('button', { name: 'Resolve review thread' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss review thread' }))

    expect(onSetThreadStatus.mock.calls).toEqual([['rt_1', 'resolved'], ['rt_1', 'dismissed']])
  })

  it('keeps a dismissed thread readable and offers to reopen it', async () => {
    const onSetThreadStatus = vi.fn()
    const setup = makeProps({
      data: makeReviewThreadData(makeReviewThread({ status: 'dismissed' })),
      onSetThreadStatus,
    })
    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Needs a null check')).toBeTruthy()
    expect(screen.getByText('Dismissed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dismiss review thread' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Reopen review thread' }))

    expect(onSetThreadStatus).toHaveBeenCalledWith('rt_1', 'open')
  })

  it('hides the status actions when the embedding surface supplies no status callback', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread()) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.queryByRole('button', { name: 'Resolve review thread' })).toBeNull()
  })

  it('reports a resolved thread whose agent turn failed as both', () => {
    const setup = makeProps({
      data: makeReviewThreadData(makeReviewThread({ status: 'resolved', awaiting: 'error' })),
      onSetThreadStatus: vi.fn(),
    })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Resolved')).toBeTruthy()
    expect(screen.getByText('Agent reply failed')).toBeTruthy()
  })

  it('reports a thread that is waiting on an agent', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread({ awaiting: 'agent' })) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Waiting for agent')).toBeTruthy()
  })

  it('never attributes a stored message to the reading user', () => {
    const setup = makeProps({ data: makeReviewThreadData(makeReviewThread({ origin: 'plugin' })) })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.queryByText('You')).toBeNull()
    expect(screen.getByText('Reviewer')).toBeTruthy()
  })
  it('names the author of each message when an agent thread and a reviewer thread share a line', () => {
    const agentThread = makeReviewThread({
      id: 'rt_agent',
      origin: 'agent',
      messages: [{ id: 'rtm_a', role: 'agent', body: 'Agent found a leak', createdAt: 1 }],
    })
    const humanThread = makeReviewThread({
      id: 'rt_human',
      origin: 'human',
      messages: [{ id: 'rtm_h', role: 'human', body: 'Rename this variable', createdAt: 1 }],
    })
    const setup = makeProps({
      data: { comments: [{ type: 'thread', thread: agentThread }, { type: 'thread', thread: humanThread }] },
    })

    render(InlineCommentThread, { props: setup.props })

    expect(screen.getByText('Agent found a leak')).toBeTruthy()
    expect(screen.getByText('Rename this variable')).toBeTruthy()
    expect(screen.getAllByText('Agent')).toHaveLength(2)
    expect(screen.getAllByText('Reviewer')).toHaveLength(2)
  })
})
