import { describe, expect, it, vi } from 'vitest'
import type { CommentSelectionState } from '../../lib/useCommentSelection.svelte'
import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'

describe('self review feedback pane', () => {
  it('presents live PR and inline feedback state with navigation actions', () => {
    const unaddressedComment = { id: 1 } as PrComment
    const addressedComment = { id: 2 } as PrComment
    const pendingComment = { path: 'src/main.ts' } as ReviewSubmissionComment
    const selectedPrCommentIds = new Set([1, 2])
    const selection = {
      unaddressedCount: 1,
      threadRoots: [unaddressedComment, addressedComment],
      unaddressedComments: [unaddressedComment],
      hiddenThreadCount: 1,
      selectedPrCommentIds,
      toggleSelected: (id: number) => selectedPrCommentIds.delete(id),
    } as unknown as CommentSelectionState
    let pendingInlineComments = [pendingComment]
    let showAddressed = false
    let sidebarVisible = true

    const pane = createSelfReviewFeedbackPane({
      diff: {
        linkedPr: null,
        prComments: [unaddressedComment, addressedComment],
        refresh: vi.fn(),
      },
      comments: {
        commentSelection: selection,
        get pendingInlineComments() { return pendingInlineComments },
        markdownImageBaseUrl: null,
        resolveRemoteMedia: vi.fn(),
        get feedbackCount() { return pendingInlineComments.length },
        captureReviewFeedback: vi.fn(),
      },
      navigation: {
        get showAddressed() { return showAddressed },
        setSidebarVisible: (visible) => { sidebarVisible = visible },
        setShowAddressed: (value) => { showAddressed = value },
        openLinkedPr: vi.fn(),
        scrollToComment: vi.fn(),
      },
    })

    expect(pane.totalCommentCount).toBe(2)
    expect(pane.pullRequest.visibleComments).toEqual([unaddressedComment])

    pane.pullRequest.onShowAddressedChange(true)
    pane.navigation.onCollapse()

    expect(pane.pullRequest.visibleComments).toEqual([unaddressedComment, addressedComment])
    expect(sidebarVisible).toBe(false)

    pendingInlineComments = []
    expect(pane.totalCommentCount).toBe(1)
  })
})
