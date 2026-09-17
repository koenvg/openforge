import type {
  ReviewThread,
  ReviewThreadAnchor,
  ReviewThreadMessage,
  ReviewThreadStatus,
} from '@openforge-app/plugin-sdk'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type {
  AgentReviewComment,
  AgentReviewCommentStatus,
  AiThread,
  AiThreadMessage,
} from '../../lib/prReviewRecords'
import { reviewScopeForPullRequest } from './reviewScope'

export const adaptedThreadId = {
  agent: (commentId: number) => `agent:${commentId}`,
  ai: (threadId: string) => `ai:${threadId}`,
}

export type AdaptedThreadRef =
  | { kind: 'agent'; commentId: number }
  | { kind: 'ai'; threadId: string }

export function parseAdaptedThreadId(id: string): AdaptedThreadRef | null {
  if (id.startsWith('agent:')) {
    const commentId = Number(id.slice('agent:'.length))
    return Number.isInteger(commentId) ? { kind: 'agent', commentId } : null
  }
  if (id.startsWith('ai:')) return { kind: 'ai', threadId: id.slice('ai:'.length) }
  return null
}

const AGENT_STATUS_BY_DECISION: Record<ReviewThreadStatus, AgentReviewCommentStatus> = {
  open: 'pending',
  resolved: 'approved',
  dismissed: 'dismissed',
}

export function reviewerStatusForAgentComment(status: ReviewThreadStatus): AgentReviewCommentStatus {
  return AGENT_STATUS_BY_DECISION[status]
}

export function agentCommentFollowUp(aiThreads: AiThread[], commentId: number): AiThread | undefined {
  return aiThreads.find(thread => thread.anchor.type === 'comment' && thread.anchor.comment_id === commentId)
}

function agentCommentStatus(status: AgentReviewCommentStatus): ReviewThreadStatus | null {
  if (status === 'approved') return 'resolved'
  if (status === 'dismissed') return null
  return 'open'
}

function toMessages(id: string, messages: AiThreadMessage[], offset = 0): ReviewThreadMessage[] {
  return messages.map((message, index) => ({
    id: `${id}:m${offset + index}`,
    role: message.role === 'ai' ? 'agent' : 'human',
    body: message.body,
    createdAt: message.created_at,
  }))
}

function lastAgentMessageAt(messages: ReviewThreadMessage[]): number {
  return messages.reduce(
    (latest, message) => (message.role === 'agent' ? Math.max(latest, message.createdAt) : latest),
    Number.NEGATIVE_INFINITY,
  )
}

function agentCommentToThread(
  pr: ReviewPullRequest,
  comment: AgentReviewComment,
  followUp: AiThread | undefined,
): ReviewThread | null {
  if (comment.comment_type !== 'inline') return null
  if (comment.file_path === null || comment.line_number === null) return null
  const status = agentCommentStatus(comment.status)
  if (status === null) return null

  const id = adaptedThreadId.agent(comment.id)
  const messages: ReviewThreadMessage[] = [
    { id: `${id}:m0`, role: 'agent', body: comment.body, createdAt: comment.created_at },
    ...toMessages(id, followUp?.messages ?? [], 1),
  ]
  const seenAt = followUp?.seen_at ?? null

  return {
    id,
    ...reviewScopeForPullRequest(pr),
    origin: 'agent',
    anchor: { kind: 'line', filePath: comment.file_path, line: comment.line_number, side: comment.side ?? 'RIGHT' },
    status,
    awaiting: followUp ? aiThreadAwaiting(followUp.status) : 'none',
    runId: null,
    idempotencyKey: null,
    seenAt,
    hasUnreadAgentMessage: followUp ? lastAgentMessageAt(messages.slice(1)) > (seenAt ?? Number.NEGATIVE_INFINITY) : false,
    createdAt: comment.created_at,
    updatedAt: Math.max(comment.updated_at, followUp?.updated_at ?? 0),
    messages,
  }
}

function aiThreadAnchor(anchor: AiThread['anchor']): ReviewThreadAnchor {
  if (anchor.type === 'step') return { kind: 'custom', key: `step:${anchor.step_id}` }
  return { kind: 'line', filePath: anchor.filename, line: anchor.line, side: anchor.side }
}

function aiThreadAwaiting(status: AiThread['status']): ReviewThread['awaiting'] {
  if (status === 'error') return 'error'
  return status === 'answered' ? 'none' : 'agent'
}

function aiThreadToThread(pr: ReviewPullRequest, thread: AiThread): ReviewThread {
  const id = adaptedThreadId.ai(thread.id)
  const messages = toMessages(id, thread.messages)
  const seenAt = thread.seen_at ?? null

  return {
    id,
    ...reviewScopeForPullRequest(pr),
    origin: 'human',
    anchor: aiThreadAnchor(thread.anchor),
    status: thread.reviewer_status ?? 'open',
    awaiting: aiThreadAwaiting(thread.status),
    runId: null,
    idempotencyKey: null,
    seenAt,
    hasUnreadAgentMessage: lastAgentMessageAt(messages) > (seenAt ?? Number.NEGATIVE_INFINITY),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messages,
  }
}

export interface ReviewThreadAdapterInput {
  pr: ReviewPullRequest
  agentComments: AgentReviewComment[]
  aiThreads: AiThread[]
}

/**
 * GitHub Sync keeps the storage and the parse-based writes; only the diff
 * viewer's input moves. A follow-up question about an agent comment is folded
 * into that comment's own thread, so the `comment` anchor never surfaces.
 */
export function toReviewThreads({ pr, agentComments, aiThreads }: ReviewThreadAdapterInput): ReviewThread[] {
  const threads: ReviewThread[] = []
  const foldedThreadIds = new Set<string>()

  for (const comment of agentComments) {
    const followUp = agentCommentFollowUp(aiThreads, comment.id)
    const thread = agentCommentToThread(pr, comment, followUp)
    if (!thread) continue
    threads.push(thread)
    if (followUp) foldedThreadIds.add(followUp.id)
  }

  for (const thread of aiThreads) {
    if (foldedThreadIds.has(thread.id)) continue
    threads.push(aiThreadToThread(pr, thread))
  }
  return threads
}
