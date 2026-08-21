import { describe, expect, it, vi } from 'vitest'
import type { CommentSelectionState } from '../../lib/useCommentSelection.svelte'
import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'

describe('self review feedback pane', () => {
  it('presents live feedback state and owns its navigation actions', () => {
    const unaddressedComment = { id: 1 } as PrComment
    const addressedComment = { id: 2 } as PrComment
    const pendingComment = { path: 'src/main.ts' } as ReviewSubmissionComment
    const deselectAll = vi.fn()
    const selection = {
      unaddressedCount: 1,
      unaddressedComments: [unaddressedComment],
      deselectAll,
    } as unknown as CommentSelectionState
    let generalCommentCount = 2
    let pendingInlineComments = [pendingComment]
    let showAddressed = false
    let sidebarVisible = true
    let sidebarTab: 'pr' | 'notes' = 'pr'

    const pane = createSelfReviewFeedbackPane({
      getTaskId: () => 'KVG-1',
      diff: {
        linkedPr: null,
        prComments: [unaddressedComment, addressedComment],
        refresh: vi.fn(),
      },
      comments: {
        commentSelection: selection,
        get generalCommentCount() { return generalCommentCount },
        get pendingInlineComments() { return pendingInlineComments },
        markdownImageBaseUrl: null,
        resolveRemoteMedia: vi.fn(),
        handlePendingInlineCommentsChange: (comments) => { pendingInlineComments = comments },
      },
      navigation: {
        get sidebarTab() { return sidebarTab },
        get showAddressed() { return showAddressed },
        setSidebarVisible: (visible) => { sidebarVisible = visible },
        setSidebarTab: (tab) => { sidebarTab = tab },
        setShowAddressed: (value) => { showAddressed = value },
        openLinkedPr: vi.fn(),
        scrollToComment: vi.fn(),
      },
    })

    expect(pane.totalCommentCount).toBe(4)
    expect(pane.pullRequest.visibleComments).toEqual([unaddressedComment])
    expect(pane.general).toMatchObject({ taskId: 'KVG-1', commentCount: 2 })

    pane.pullRequest.onShowAddressedChange(true)
    pane.navigation.onActiveTabChange('notes')
    pane.navigation.onCollapse()
    pane.composer.onSendComplete()

    expect(pane.pullRequest.visibleComments).toEqual([unaddressedComment, addressedComment])
    expect(pane.navigation.activeTab).toBe('notes')
    expect(sidebarVisible).toBe(false)
    expect(deselectAll).toHaveBeenCalledOnce()

    generalCommentCount = 0
    pane.composer.onPendingInlineCommentsChange([])
    expect(pane.totalCommentCount).toBe(1)
  })
})
