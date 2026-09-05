import type { AiThread, AgentReviewComment } from '@openforge-app/plugin-sdk/domain'

// A single collected view of every place in a PR review that still wants the
// reviewer's attention: questions they wrote (drafts to send, answers to read),
// questions in flight, and AI suggestions they haven't ruled on. All of it is
// derived from data already in memory for the open PR — nothing new is stored
// except a per-thread `seen_at` bit (see markThreadSeen).

export type QuestionGroupKey =
  | 'needs_sending'
  | 'answers_to_read'
  | 'suggestions_to_review'
  | 'waiting'
  | 'done'

/** Display order: things the reviewer must act on first, then in-flight, then handled. */
export const QUESTION_GROUP_ORDER: QuestionGroupKey[] = [
  'needs_sending',
  'answers_to_read',
  'suggestions_to_review',
  'waiting',
  'done',
]

/** The three groups that represent outstanding work; drives the panel's badge. */
const ACTIONABLE_GROUPS: QuestionGroupKey[] = ['needs_sending', 'answers_to_read', 'suggestions_to_review']

/** Where a row jumps to when clicked. Mirrors the two navigable surfaces. */
export type QuestionTarget =
  | { kind: 'diff'; filename: string; line: number | null; side: 'LEFT' | 'RIGHT' | null }
  | { kind: 'step'; stepId: string }

export type QuestionSource =
  | { kind: 'thread'; thread: AiThread }
  | { kind: 'suggestion'; comment: AgentReviewComment }

export interface QuestionItem {
  key: string
  group: QuestionGroupKey
  target: QuestionTarget
  /** The question (or suggestion) text, so the row is recognisable at a glance. */
  preview: string
  updatedAt: number
  source: QuestionSource
}

export interface QuestionsIndex {
  groups: Record<QuestionGroupKey, QuestionItem[]>
  order: QuestionGroupKey[]
  actionableCount: number
  totalCount: number
}

function lastMessage(thread: AiThread) {
  return thread.messages[thread.messages.length - 1]
}

/** Which group a thread belongs to, or null if it should not appear at all. */
function classifyThread(thread: AiThread): QuestionGroupKey | null {
  if (thread.messages.length === 0) return null
  if (thread.status === 'pending') return 'waiting'

  const last = lastMessage(thread)
  if (last.role === 'user') return 'needs_sending'

  // last.role === 'ai': an answer exists. It is unread until seen_at catches up
  // to the newest answer, so a follow-up answer re-surfaces without clearing seen_at.
  const seenAt = thread.seen_at ?? null
  if (seenAt === null || seenAt < last.created_at) return 'answers_to_read'
  return 'done'
}

function threadTarget(thread: AiThread): QuestionTarget {
  const anchor = thread.anchor
  if (anchor.type === 'step') return { kind: 'step', stepId: anchor.step_id }
  return { kind: 'diff', filename: anchor.filename, line: anchor.line, side: anchor.side }
}

function threadPreview(thread: AiThread): string {
  const firstUser = thread.messages.find(m => m.role === 'user')
  return firstUser?.body ?? thread.messages[0]?.body ?? ''
}

export function buildQuestionsIndex(
  threads: AiThread[],
  suggestions: AgentReviewComment[],
): QuestionsIndex {
  const groups: Record<QuestionGroupKey, QuestionItem[]> = {
    needs_sending: [],
    answers_to_read: [],
    suggestions_to_review: [],
    waiting: [],
    done: [],
  }

  for (const thread of threads) {
    const group = classifyThread(thread)
    if (group === null) continue
    groups[group].push({
      key: thread.id,
      group,
      target: threadTarget(thread),
      preview: threadPreview(thread),
      updatedAt: thread.updated_at,
      source: { kind: 'thread', thread },
    })
  }

  for (const comment of suggestions) {
    if (comment.status !== 'pending') continue
    groups.suggestions_to_review.push({
      key: `suggestion:${comment.id}`,
      group: 'suggestions_to_review',
      target: { kind: 'diff', filename: comment.file_path ?? '', line: comment.line_number, side: comment.side as 'LEFT' | 'RIGHT' | null },
      preview: comment.body,
      updatedAt: comment.updated_at,
      source: { kind: 'suggestion', comment },
    })
  }

  for (const key of QUESTION_GROUP_ORDER) {
    groups[key].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const actionableCount = ACTIONABLE_GROUPS.reduce((sum, key) => sum + groups[key].length, 0)
  const totalCount = QUESTION_GROUP_ORDER.reduce((sum, key) => sum + groups[key].length, 0)

  return { groups, order: QUESTION_GROUP_ORDER, actionableCount, totalCount }
}

/** Mark one thread's current answer as read, returning a new array. */
export function markThreadSeen(threads: AiThread[], id: string, at: number): AiThread[] {
  return threads.map(t => (t.id === id ? { ...t, seen_at: at } : t))
}
