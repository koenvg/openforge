import type {
  CreateReviewThreadRequest,
  MarkReviewThreadSeenRequest,
  ReplyToReviewThreadRequest,
  ReviewThread,
  ReviewThreadScope,
  SetReviewThreadAwaitingRequest,
  SetReviewThreadStatusRequest,
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
    awaiting: request.awaiting,
  })
}

export async function setReviewThreadStatus(request: SetReviewThreadStatusRequest): Promise<ReviewThread> {
  return invoke<ReviewThread>('set_review_thread_status', {
    threadId: request.threadId,
    status: request.status,
  })
}

export async function setReviewThreadAwaiting(request: SetReviewThreadAwaitingRequest): Promise<ReviewThread> {
  return invoke<ReviewThread>('set_review_thread_awaiting', {
    threadId: request.threadId,
    awaiting: request.awaiting,
  })
}

export async function markReviewThreadSeen(request: MarkReviewThreadSeenRequest): Promise<ReviewThread> {
  return invoke<ReviewThread>('mark_review_thread_seen', {
    threadId: request.threadId,
  })
}
