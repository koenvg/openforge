import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import type { PrComment } from '../../../lib/types'
import PrCommentsList from './PrCommentsList.svelte'

vi.mock('../../../lib/ipc', () => ({ openUrl: vi.fn() }))

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    pr_id: 1,
    author: 'alice',
    body: 'a comment',
    comment_type: 'review_comment',
    file_path: 'src/a.ts',
    line_number: 1,
    addressed: 0,
    outdated: 0,
    created_at: 0,
    ...overrides,
  }
}

describe('PrCommentsList author filter', () => {
  it('resets to all reviewers when the filtered author has no comments left', async () => {
    const { rerender } = render(PrCommentsList, {
      props: {
        comments: [
          makeComment({ id: 1, author: 'alice', body: 'alice comment' }),
          makeComment({ id: 2, author: 'bob', body: 'bob comment' }),
        ],
        showAuthorFilter: true,
      },
    })

    // Both comments visible initially.
    expect(screen.getByText('alice comment')).toBeTruthy()
    expect(screen.getByText('bob comment')).toBeTruthy()

    // Filter to alice → only alice's comment shows.
    const trigger = screen.getByRole('button', { name: 'Filter comments by reviewer' })
    trigger.focus()
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await fireEvent.pointerUp(await screen.findByRole('option', { name: 'alice' }), { button: 0 })
    expect(screen.getByText('alice comment')).toBeTruthy()
    expect(screen.queryByText('bob comment')).toBeNull()

    // Alice's comment is removed (e.g. marked addressed) leaving only bob.
    // The panel must NOT go blank — it falls back to showing everyone.
    await rerender({
      comments: [makeComment({ id: 2, author: 'bob', body: 'bob comment' })],
      showAuthorFilter: true,
    })

    expect(await screen.findByText('bob comment')).toBeTruthy()
  })

  it('renders an Outdated badge when a comment is outdated', () => {
    render(PrCommentsList, {
      props: {
        comments: [makeComment({ id: 3, author: 'alice', body: 'stale', outdated: 1 })],
      },
    })
    expect(screen.getByText('Outdated')).toBeTruthy()
  })

  it('shows uploads pasted into a comment once they are resolved', async () => {
    const uploadUrl = 'https://github.com/user-attachments/assets/upload-id'
    const signedUrl = 'https://cdn.example.com/shot.png?jwt=signed'
    const resolveRemoteMedia = vi.fn(async () => ({ url: signedUrl, kind: 'image' as const }))

    render(PrCommentsList, {
      props: {
        comments: [makeComment({ id: 4, body: `![Screenshot](${uploadUrl})` })],
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Screenshot' }).getAttribute('src')).toBe(signedUrl)
    })
    expect(resolveRemoteMedia).toHaveBeenCalledWith(uploadUrl)
  })
})
