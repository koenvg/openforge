import { afterEach, describe, expect, it } from 'vitest'
import type { SelfReviewTaskState } from '../../lib/taskScopedSelfReviewState'
import type { ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewCommentController } from './selfReviewCommentController.svelte'

const hiddenComment: ReviewSubmissionComment = {
  path: 'src/hidden.ts',
  line: 2,
  body: 'Keep this comparison comment',
  side: 'RIGHT',
}
const visibleComment: ReviewSubmissionComment = {
  path: 'src/visible.ts',
  line: 4,
  body: 'Visible comment',
  side: 'RIGHT',
}
const rootCleanups: Array<() => void> = []

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewCommentController', () => {
  it('hides comparison comments while preserving them when visible comments change', () => {
    let state = $state<SelfReviewTaskState>({
      diffFiles: [],
      generalComments: [],
      archivedComments: [],
      pendingInlineComments: [hiddenComment, visibleComment],
      inlineCommentDrafts: new Map(),
    })
    let controller!: ReturnType<typeof createSelfReviewCommentController>
    const cleanup = $effect.root(() => {
      controller = createSelfReviewCommentController({
        getTaskId: () => 'task-1',
        getState: () => state,
        getPrComments: () => [],
        getComparisonFilenames: () => new Set([hiddenComment.path]),
        setPendingComments: (_taskId, comments) => {
          state = { ...state, pendingInlineComments: comments }
        },
      })
    })
    rootCleanups.push(cleanup)

    expect(controller.visiblePendingInlineComments).toEqual([visibleComment])

    const updatedVisibleComment = { ...visibleComment, body: 'Updated visible comment' }
    controller.handlePendingInlineCommentsChange([updatedVisibleComment])

    expect(controller.pendingInlineComments).toEqual([hiddenComment, updatedVisibleComment])
  })
})
