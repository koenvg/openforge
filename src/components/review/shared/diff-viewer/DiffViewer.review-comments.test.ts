import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff, ReviewSubmissionComment } from '../../../../lib/types'
import { requireElement } from '../../../../test-utils/dom'
import { getSelfReviewInlineCommentDraft, selfReviewStateByTask } from '../../../../lib/taskScopedReviewComments'
import { mockDiffView } from './DiffViewer.test-harness'
import { buildExtendData } from '@openforge-app/pr-review-ui/diffComments'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

describe('DiffViewer reviewed files', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const diffFile = { clearId: vi.fn() }
    const { createDiffWorker } = await import('@openforge-app/pr-review-ui/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => diffFile as never,
      processing: false,
    })
  })

  it('collapses the file body when the header Reviewed checkbox is checked', async () => {
    const onToggleFileReviewed = vi.fn()
    render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        reviewedFileShas: new Map(),
        onToggleFileReviewed,
        getFileReviewIdentity: (file: PrFileDiff) => file.sha.trim() || null,
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-view')).toBeTruthy()
    })

    const checkbox = requireElement(screen.getByRole('checkbox', { name: 'Mark src/test.ts reviewed' }), HTMLInputElement)
    expect(checkbox.checked).toBe(false)

    await fireEvent.click(checkbox)

    expect(onToggleFileReviewed).toHaveBeenCalledWith(expect.objectContaining({ filename: 'src/test.ts' }), true)
    await waitFor(() => {
      expect(screen.queryByTestId('mock-diff-view')).toBeNull()
    })
  })

  it('keeps the header Reviewed checkbox available while collapsed and expands when unchecked', async () => {
    const onToggleFileReviewed = vi.fn()
    render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        reviewedFileShas: new Map([['src/test.ts', 'abc123']]),
        onToggleFileReviewed,
        getFileReviewIdentity: (file: PrFileDiff) => file.sha.trim() || null,
      },
    })

    const checkbox = requireElement(await screen.findByRole('checkbox', { name: 'Mark src/test.ts reviewed' }), HTMLInputElement)
    expect(checkbox.checked).toBe(true)
    await waitFor(() => {
      expect(screen.queryByTestId('mock-diff-view')).toBeNull()
    })

    await fireEvent.click(checkbox)

    expect(onToggleFileReviewed).toHaveBeenCalledWith(expect.objectContaining({ filename: 'src/test.ts' }), false)
    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-view')).toBeTruthy()
    })
  })
})

describe('DiffViewer pending comments source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses provided pending comments instead of the global PR review pending comments', async () => {
    const diffFile = { clearId: vi.fn() }
    const { createDiffWorker } = await import('@openforge-app/pr-review-ui/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => diffFile as never,
      processing: false,
    })
    const pendingComments: ReviewSubmissionComment[] = [
      { path: 'src/test.ts', line: 2, side: 'RIGHT', body: 'task scoped comment' },
    ]

    render(DiffViewer, { props: { files: [modifiedFileWithPatch], pendingComments, onPendingCommentsChange: vi.fn() } })

    await waitFor(() => {
      expect(mockDiffView).toHaveBeenCalled()
    })
    const lastCall = mockDiffView.mock.calls.at(-1)
    void lastCall?.[1]?.extendData

    expect(buildExtendData).toHaveBeenCalledWith('src/test.ts', [], pendingComments, [], [], [])
  })
})

describe('DiffViewer inline textarea drafts', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    selfReviewStateByTask.set(new Map())
    globalThis.__diffViewerTestWidget = undefined
    const diffFile = { clearId: vi.fn() }
    const { createDiffWorker } = await import('@openforge-app/pr-review-ui/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => diffFile as never,
      processing: false,
    })
  })

  function renderOpenInlineWidget(lineNumber: number, side: number) {
    globalThis.__diffViewerTestWidget = { lineNumber, side }
  }


  it('focuses the inline comment textarea after the source diff add button finishes handling its press', async () => {
    globalThis.__diffViewerTestWidget = { lineNumber: 2, side: 2, initiallyOpen: false }
    render(DiffViewer, { props: { files: [modifiedFileWithPatch] } })

    const addComment = await screen.findByRole('button', { name: 'Add comment to source diff line 2' })
    await fireEvent.mouseDown(addComment)
    addComment.focus()
    expect(document.activeElement).toBe(addComment)

    const textarea = await screen.findByRole('textbox', { name: 'Inline review comment for src/test.ts line 2' })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(document.activeElement).toBe(textarea)
  })
  it('restores an open self-review inline textarea draft after the diff viewer remounts', async () => {
    renderOpenInlineWidget(2, 2)
    const firstRender = render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        inlineDraftScopeId: 'task-1',
      },
    })

    const textarea = await screen.findByPlaceholderText('Leave a comment…')
    await fireEvent.input(textarea, { target: { value: 'draft before add comment' } })

    expect(getSelfReviewInlineCommentDraft('task-1', 'src/test.ts', 2, 'RIGHT')).toBe('draft before add comment')

    firstRender.unmount()

    renderOpenInlineWidget(2, 2)
    render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        inlineDraftScopeId: 'task-1',
      },
    })

    await waitFor(() => {
      expect(screen.getByDisplayValue('draft before add comment')).toBeTruthy()
    })
  })

  it('does not restore an inline textarea draft for a different task scope', async () => {
    renderOpenInlineWidget(2, 2)
    const firstRender = render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        inlineDraftScopeId: 'task-1',
      },
    })

    const textarea = await screen.findByPlaceholderText('Leave a comment…')
    await fireEvent.input(textarea, { target: { value: 'task one draft' } })
    firstRender.unmount()

    renderOpenInlineWidget(2, 2)
    render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        inlineDraftScopeId: 'task-2',
      },
    })

    const taskTwoTextarea = await screen.findByPlaceholderText('Leave a comment…')
    expect(taskTwoTextarea).toBeInstanceOf(HTMLTextAreaElement)
    expect((taskTwoTextarea as HTMLTextAreaElement).value).toBe('')
  })

  it('clears the stored inline textarea draft after adding the pending comment', async () => {
    renderOpenInlineWidget(2, 2)
    const onPendingCommentsChange = vi.fn()
    render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
        pendingComments: [],
        onPendingCommentsChange,
        inlineDraftScopeId: 'task-1',
      },
    })

    const textarea = await screen.findByPlaceholderText('Leave a comment…')
    await fireEvent.input(textarea, { target: { value: 'pending comment body' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))

    expect(onPendingCommentsChange).toHaveBeenCalledWith([
      { path: 'src/test.ts', line: 2, side: 'RIGHT', body: 'pending comment body' },
    ])
    expect(getSelfReviewInlineCommentDraft('task-1', 'src/test.ts', 2, 'RIGHT')).toBe('')
  })
})
