import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import PrCommentsList from './PrCommentsList.svelte'
import type { PrComment } from '../../../lib/types'

// MarkdownContent (rendered for each comment body) imports openUrl from ipc.
// Stub it so the module doesn't pull in Electron/preload globals under jsdom.
vi.mock('../../../lib/ipc', () => ({
  openUrl: vi.fn(),
}))

const LONG_PATH =
  'packages/plugin-sdk/src/components/deeply/nested/directory/structure/that/keeps/going/and/going/PrCommentsList.stories.tsx'

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    pr_id: 10,
    author: 'octocat',
    body: 'Please rename this variable.',
    comment_type: 'review',
    file_path: LONG_PATH,
    line_number: 42,
    addressed: 0,
    created_at: 1_700_000_000,
    ...overrides,
  }
}

describe('PrCommentsList', () => {
  it('renders a working "Mark addressed" button for each comment even when the file path is very long', async () => {
    const onMarkAddressed = vi.fn()
    const comments = [
      makeComment({ id: 1 }),
      makeComment({ id: 2, author: 'hubot' }),
    ]

    render(PrCommentsList, {
      props: { comments, onMarkAddressed, showLocation: true, showMarkAddressed: true },
    })

    const buttons = screen.getAllByRole('button', { name: /mark addressed/i })
    expect(buttons).toHaveLength(2)

    // The button must stay wired/clickable regardless of the (long) path length.
    await fireEvent.click(buttons[0])
    expect(onMarkAddressed).toHaveBeenCalledWith(1)

    await fireEvent.click(buttons[1])
    expect(onMarkAddressed).toHaveBeenCalledWith(2)
  })

  it('renders the file path with the line number when a location is shown', () => {
    const { container } = render(PrCommentsList, {
      props: { comments: [makeComment({ line_number: 42 })], showLocation: true },
    })

    expect(container.textContent).toContain(`${LONG_PATH}:42`)
  })

  it('renders the file path without a trailing colon when there is no line number', () => {
    const { container } = render(PrCommentsList, {
      props: { comments: [makeComment({ line_number: null })], showLocation: true },
    })

    expect(container.textContent).toContain(LONG_PATH)
    expect(container.textContent).not.toContain(`${LONG_PATH}:`)
  })

  it('does not render a "Mark addressed" button when addressing is disabled (task-detail info panel)', () => {
    render(PrCommentsList, {
      props: {
        comments: [makeComment()],
        onMarkAddressed: vi.fn(),
        showLocation: true,
        showMarkAddressed: false,
      },
    })

    expect(screen.queryByRole('button', { name: /mark addressed/i })).toBeNull()
  })

  it('renders the comment body text', () => {
    render(PrCommentsList, {
      props: { comments: [makeComment({ body: 'Please rename this variable.' })] },
    })

    expect(screen.getByText(/please rename this variable/i)).not.toBeNull()
  })
})
