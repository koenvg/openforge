/**
 * The plugin keeps these records after core retired both shapes: GitHub Sync
 * still owns the `pr-ai-review:*` and `pr-ai-threads:*` storage and its
 * parse-based writes, and adapts them onto the review-thread input.
 */

export type ReviewSide = 'LEFT' | 'RIGHT'
export type AgentReviewCommentType = 'inline' | 'summary'
export type AgentReviewCommentStatus = 'pending' | 'approved' | 'dismissed'

export interface AgentReviewComment {
  id: number
  review_pr_id: number
  review_session_key: string
  comment_type: AgentReviewCommentType
  file_path: string | null
  line_number: number | null
  side: ReviewSide | null
  body: string
  status: AgentReviewCommentStatus
  opencode_session_id: string | null
  created_at: number
  updated_at: number
}

export interface AiThreadMessage {
  role: 'user' | 'ai'
  body: string
  created_at: number
}

export type AiThreadAnchor =
  | { type: 'line'; filename: string; line: number; side: ReviewSide }
  | { type: 'step'; step_id: string }
  | { type: 'comment'; comment_id: number; filename: string; line: number; side: ReviewSide }

/** A reviewer decision, independent of the agent turn `status` tracks. */
export type AiThreadReviewerStatus = 'open' | 'resolved' | 'dismissed'

export interface AiThread {
  id: string
  anchor: AiThreadAnchor
  status: 'draft' | 'pending' | 'answered' | 'error'
  messages: AiThreadMessage[]
  created_at: number
  updated_at: number
  /**
   * When the reviewer last opened this thread's answer, in the same unit as
   * message `created_at`. A newer answer makes it unread again without
   * clearing the field.
   */
  seen_at?: number | null
  /** Absent means open. */
  reviewer_status?: AiThreadReviewerStatus
}
