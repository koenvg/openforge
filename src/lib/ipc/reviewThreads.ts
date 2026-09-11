import type {
  CreateReviewThreadRequest,
  ReplyToReviewThreadRequest,
  ReviewThread,
  ReviewThreadScope,
} from '@openforge-app/plugin-sdk'
import { invokeDesktopCommand as invoke } from '../desktopIpc'

export async function listReviewThreads(scope: ReviewThreadScope): Promise<ReviewThread[]> {
  return invoke<ReviewThread[]>('list_review_threads', {
    namespace: scope.namespace,
    targetKey: scope.targetKey,
    revision: scope.revision,
  })
}

export async function createReviewThread(request: CreateReviewThreadRequest): Promise<ReviewThread> {
  return invoke<ReviewThread>('create_review_thread', {
    namespace: request.namespace,
    targetKey: request.targetKey,
    revision: request.revision,
    anchor: request.anchor,
    origin: request.origin,
    body: request.body,
    runId: request.runId,
    idempotencyKey: request.idempotencyKey,
  })
}

export async function replyToReviewThread(request: ReplyToReviewThreadRequest): Promise<ReviewThread> {
  return invoke<ReviewThread>('reply_to_review_thread', {
    threadId: request.threadId,
    role: request.role,
    body: request.body,
  })
}
