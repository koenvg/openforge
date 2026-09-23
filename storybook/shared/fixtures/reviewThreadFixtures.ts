import type { ReviewThread } from '@openforge-app/plugin-sdk'
import type { CommentDisplayData } from '../../../packages/pr-review-ui/src/diffComments'
import type { OrphanedReviewThread } from '../../../packages/pr-review-ui/src/reviewThreadAnchors'

export const reviewThread: ReviewThread & { anchor: Extract<ReviewThread['anchor'], { kind: 'line' }> } = {
  id: 'rt-catalog', namespace: 'github', targetKey: 'gh:openforge/openforge#42', revision: 'abc123',
  anchor: { kind: 'line', filePath: 'src/greet.ts', line: 12, side: 'RIGHT' },
  origin: 'agent', status: 'open', awaiting: 'none', runId: null,
  idempotencyKey: null, seenAt: null, hasUnreadAgentMessage: false,
  createdAt: 1, updatedAt: 1,
  messages: [
    { id: 'message-1', role: 'agent', body: 'Check the empty name before trimming.', createdAt: 1 },
    { id: 'message-2', role: 'human', body: 'Good catch; I will add a guard.', createdAt: 2 },
  ],
}

export const reviewCommentThread: CommentDisplayData = {
  comments: [
    { type: 'existing', commentId: 23, body: 'Existing review comment', author: 'reviewer', createdAt: '2026-01-02T09:00:00Z', isReply: false },
    { type: 'thread', thread: reviewThread },
    { type: 'pending', body: 'Pending reviewer note', index: 0 },
  ],
}

export const orphanedReviewThreads: OrphanedReviewThread[] = [
  { thread: reviewThread, reason: 'line-not-in-diff' },
]
