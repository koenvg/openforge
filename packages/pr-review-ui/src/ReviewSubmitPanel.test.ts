import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'

function requireTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector('textarea')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Expected textarea')
  return textarea
}

type ReviewSubmitPanelProps = ComponentProps<typeof ReviewSubmitPanel>

function renderPanel(overrides: Partial<ReviewSubmitPanelProps> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onSubmitReview = vi.fn().mockResolvedValue(undefined)
  const props = {
    repoOwner: 'acme',
    repoName: 'repo',
    prNumber: 42,
    commitId: 'abc123',
    pendingComments: [],
    onPendingCommentsChange,
    onSubmitReview,
    ...overrides,
  }

  const result = render(ReviewSubmitPanel, { props })
  return { ...result, onPendingCommentsChange, onSubmitReview }
}

describe('ReviewSubmitPanel', () => {
  it('renders Submit Review heading', () => {
    renderPanel()
    expect(screen.getByText('Submit Review')).toBeTruthy()
  })

  it('shows pending comment count with plural and singular labels', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'comment 2' },
    ]
    const { rerender } = renderPanel({ pendingComments: comments })

    expect(screen.getByText('2 comments will be submitted')).toBeTruthy()

    rerender({
      repoOwner: 'acme',
      repoName: 'repo',
      prNumber: 42,
      commitId: 'abc123',
      pendingComments: comments.slice(0, 1),
      onPendingCommentsChange: vi.fn(),
      onSubmitReview: vi.fn(),
    })
    expect(screen.getByText('1 comment will be submitted')).toBeTruthy()
  })

  it('labels the review summary textarea and describes the keyboard shortcut', () => {
    renderPanel()

    const textarea = screen.getByRole('textbox', { name: 'Review summary comment' })
    expect(textarea.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText(/Submit with/)).toBeTruthy()
  })

  it('only enables comment and request changes when a summary or pending comments exist', async () => {
    const { container } = renderPanel()

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Request Changes').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Approve').closest('button')?.disabled).toBe(false)

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Review summary' } })

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false)
    expect(screen.getByText('Request Changes').closest('button')?.disabled).toBe(false)
  })

  it('submits a comment review with summary and pending comments', async () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'comment 1' },
    ]
    const { container, onSubmitReview, onPendingCommentsChange } = renderPanel({ pendingComments: comments })

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Review summary' } })
    await fireEvent.click(screen.getByText('Comment'))

    expect(onSubmitReview).toHaveBeenCalledWith({
      repoOwner: 'acme',
      repoName: 'repo',
      prNumber: 42,
      event: 'COMMENT',
      body: 'Review summary',
      comments,
      commitId: 'abc123',
    })
    expect(onPendingCommentsChange).toHaveBeenCalledWith([])
  })

  it('submits approve without requiring a summary', async () => {
    const { onSubmitReview } = renderPanel()

    await fireEvent.click(screen.getByText('Approve'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      event: 'APPROVE',
      body: '',
    }))
  })

  it('submits request changes when requested', async () => {
    const { container, onSubmitReview } = renderPanel()

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Needs work' } })
    await fireEvent.click(screen.getByText('Request Changes'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      event: 'REQUEST_CHANGES',
      body: 'Needs work',
    }))
  })

  it('shows success and error feedback for submission results', async () => {
    const success = renderPanel()
    await fireEvent.click(screen.getByText('Approve'))

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status.getAttribute('aria-live')).toBe('polite')
      expect(status.textContent?.trim()).toBe('Review submitted successfully (Approved)')
      expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    })

    success.unmount()

    renderPanel({ onSubmitReview: vi.fn().mockRejectedValue(new Error('Network error')) })
    await fireEvent.click(screen.getByText('Approve'))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.getAttribute('aria-live')).toBe('assertive')
      expect(alert.textContent?.trim()).toBe('Failed to submit review. Please try again.')
      expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    })
  })

  it('submits as comment with Cmd+Enter or Ctrl+Enter keyboard shortcut', async () => {
    for (const shortcut of [{ metaKey: true }, { ctrlKey: true }]) {
      const { container, onSubmitReview, unmount } = renderPanel()

      const textarea = requireTextarea(container)
      await fireEvent.input(textarea, { target: { value: 'Quick comment' } })
      await fireEvent.keyDown(textarea, { key: 'Enter', ...shortcut })

      await waitFor(() => {
        expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
          event: 'COMMENT',
          body: 'Quick comment',
        }))
      })

      unmount()
    }
  })

  it('does not submit or prevent default on Shift+Enter', async () => {
    const { container, onSubmitReview } = renderPanel()

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Draft with newline' } })

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onSubmitReview).not.toHaveBeenCalled()
  })

  it('counts approved AI comments alongside pending comments', () => {
    const pending: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'manual' },
    ]
    const approvedAgentComments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'approved AI' },
      { path: 'file.ts', line: 30, side: 'LEFT', body: 'approved AI 2' },
    ]
    renderPanel({ pendingComments: pending, approvedAgentComments })

    expect(screen.getByText('3 comments will be submitted')).toBeTruthy()
  })

  it('counts queued replies and enables submitting when only replies are queued', async () => {
    renderPanel({ pendingReplyCount: 2 })
    expect(screen.getByText('2 comments will be submitted')).toBeTruthy()
    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false)
  })

  it('enables submitting when only approved AI comments exist (no summary, no pending)', async () => {
    const approvedAgentComments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'approved AI' },
    ]
    renderPanel({ approvedAgentComments })

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false)
  })

  it('includes approved AI comments in the submission payload and notifies the parent', async () => {
    const pending: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 10, side: 'RIGHT', body: 'manual' },
    ]
    const approvedAgentComments: ReviewSubmissionComment[] = [
      { path: 'file.ts', line: 20, side: 'RIGHT', body: 'approved AI' },
    ]
    const onApprovedAgentCommentsSubmitted = vi.fn()
    const { onSubmitReview, onPendingCommentsChange } = renderPanel({
      pendingComments: pending,
      approvedAgentComments,
      onApprovedAgentCommentsSubmitted,
    })

    await fireEvent.click(screen.getByText('Approve'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      event: 'APPROVE',
      comments: [...pending, ...approvedAgentComments],
    }))
    await waitFor(() => {
      expect(onPendingCommentsChange).toHaveBeenCalledWith([])
      expect(onApprovedAgentCommentsSubmitted).toHaveBeenCalledOnce()
    })
  })

  it('renders a removable row with the full finding text for each included finding', async () => {
    const onRemoveIncludedFinding = vi.fn()
    renderPanel({
      includedFindings: [{ id: 'crit-1', label: 'Partial', text: 'Domains label stays plural' }],
      onRemoveIncludedFinding,
    })

    expect(screen.getByText('Partial')).toBeTruthy()
    expect(screen.getByText('Domains label stays plural')).toBeTruthy()

    await fireEvent.click(screen.getByLabelText('Remove "Partial" from review'))
    expect(onRemoveIncludedFinding).toHaveBeenCalledWith('crit-1')
  })

  it('keeps same-label findings distinguishable by showing each one\'s own text', () => {
    renderPanel({
      includedFindings: [
        { id: 'crit-1', label: 'Missing', text: 'Sessions expire after 30 minutes' },
        { id: 'crit-2', label: 'Missing', text: 'Password reset emails are not sent' },
      ],
    })

    expect(screen.getByText('Sessions expire after 30 minutes')).toBeTruthy()
    expect(screen.getByText('Password reset emails are not sent')).toBeTruthy()
    expect(screen.getAllByText('Missing')).toHaveLength(2)
  })

  it('enables submitting when only an included finding exists (no summary, no pending)', () => {
    renderPanel({ includedFindings: [{ id: 'crit-1', label: 'Partial', text: 'gap' }] })

    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false)
    expect(screen.getByText('Request Changes').closest('button')?.disabled).toBe(false)
  })

  it('folds included findings into the submitted body ahead of the typed summary, then clears them', async () => {
    const onIncludedFindingsSubmitted = vi.fn()
    const { container, onSubmitReview } = renderPanel({
      includedFindings: [{ id: 'crit-1', label: 'Partial', text: 'Tooltip dropped' }],
      onIncludedFindingsSubmitted,
    })

    const textarea = requireTextarea(container)
    await fireEvent.input(textarea, { target: { value: 'Otherwise fine.' } })
    await fireEvent.click(screen.getByText('Comment'))

    expect(onSubmitReview).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Ticket coverage gaps:\n- **Partial**: Tooltip dropped\n\nOtherwise fine.',
    }))
    await waitFor(() => {
      expect(onIncludedFindingsSubmitted).toHaveBeenCalledOnce()
    })
  })
})
