import { describe, expect, it, vi } from 'vitest'
import type { CommentSelectionState } from '../../lib/useCommentSelection.svelte'
import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'

describe('self review feedback pane', () => {
  it('presents live PR and inline feedback state with navigation actions', () => {
    const unaddressedComment = { id: 1 } as PrComment
    const addressedComment = { id: 2 } as PrComment
    const pendingComment = { path: 'src/main.ts' } as ReviewSubmissionComment
    const deselectAll = vi.fn()
    const selection = {
      unaddressedCount: 1,
      unaddressedComments: [unaddressedComment],
      deselectAll,
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
        handlePendingInlineCommentsChange: (comments) => { pendingInlineComments = comments },
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
    pane.composer.onSendComplete()

    expect(pane.pullRequest.visibleComments).toEqual([unaddressedComment, addressedComment])
    expect(sidebarVisible).toBe(false)
    expect(deselectAll).toHaveBeenCalledOnce()

    pane.composer.onPendingInlineCommentsChange([])
    expect(pane.totalCommentCount).toBe(1)
  })
})
