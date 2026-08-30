import type { AiThread, ReviewComment, ReviewSubmissionComment, AgentReviewComment, PrComment } from '@openforge-app/plugin-sdk/domain'

/**
 * Display data for comments on a single line.
 * Used by @git-diff-view/svelte ExtendData for inline annotations.
 */
export interface CommentDisplayData {
  comments: InlineCommentDisplayData[]
}

export type InlineCommentDisplayData =
  | ExistingCommentDisplayData
  | PendingCommentDisplayData
  | AgentCommentDisplayData
  | AiThreadCommentDisplayData
  | PendingReplyCommentDisplayData

interface ExistingCommentFields {
  body: string
  author: string
  type: 'existing'
  createdAt: string
}

export type ExistingCommentDisplayData =
  | (ExistingCommentFields & {
      isReply: false
      commentId: number
    })
  | (ExistingCommentFields & {
      isReply: true
    })

export interface PendingCommentDisplayData {
  body: string
  type: 'pending'
  index: number
}

export interface AgentCommentDisplayData {
  body: string
  type: 'agent'
  commentId: number
  status: string
  filePath: string
  lineNumber: number
  commentSide: 'LEFT' | 'RIGHT'
}

export interface AiThreadCommentDisplayData {
  type: 'ai-thread'
  thread: AiThread
  isReply: boolean
}

export interface PendingReplyCommentDisplayData {
  body: string
  type: 'pending-reply'
  commentId: number
}

/** A reply queued for the pending review, keyed to the existing comment it answers. */
export interface PendingReply {
  commentId: number
  body: string
}

/**
 * Maps a side string ('LEFT' or 'RIGHT') to the ExtendData object key.
 * @param side - The side string from a comment ('LEFT', 'RIGHT', or null)
 * @returns 'oldFile' for LEFT, 'newFile' for RIGHT or anything else
 */
export function sideToSplitSide(side: string | null): 'oldFile' | 'newFile' {
  return side === 'LEFT' ? 'oldFile' : 'newFile'
}

/**
 * The approved inline AI review comments that should be submitted to GitHub with
 * the review. Approving a comment no longer copies it into the manual pending
 * list — the approved comment is itself the submittable item — so submission
 * pulls straight from here. Only line-anchored inline comments qualify (summary
 * comments and comments without a line can't be posted inline).
 */
export function approvedInlineAgentComments(agentComments: AgentReviewComment[]): AgentReviewComment[] {
  return agentComments.filter(
    (comment) =>
      comment.status === 'approved' &&
      comment.comment_type === 'inline' &&
      comment.file_path !== null &&
      comment.line_number !== null,
  )
}

/** Map an AI review comment to the shape the review-submission API expects. */
export function agentCommentToSubmission(comment: AgentReviewComment): ReviewSubmissionComment {
  return {
    path: comment.file_path ?? '',
    line: comment.line_number ?? 0,
    side: (comment.side ?? 'RIGHT') as ReviewSubmissionComment['side'],
    body: comment.body.trim(),
  }
}

/**
 * Checks if a comment's path matches the target filename.
 * Uses the same matching logic as DiffViewer.svelte findLineRow():
 * exact match OR endsWith in either direction.
 */
function pathMatches(commentPath: string, targetFilename: string): boolean {
  if (commentPath === targetFilename) return true
  if (targetFilename.endsWith(commentPath)) return true
  if (commentPath.endsWith(targetFilename)) return true
  return false
}

export function buildExtendData(
  filename: string,
  existingComments: ReviewComment[],
  pendingComments: ReviewSubmissionComment[],
  agentComments: AgentReviewComment[] = [],
  aiThreads: AiThread[] = [],
  pendingReplies: PendingReply[] = []
): {
  oldFile: Record<string, { data: CommentDisplayData }>
  newFile: Record<string, { data: CommentDisplayData }>
} {
  const oldFile: Record<string, { data: CommentDisplayData }> = {}
  const newFile: Record<string, { data: CommentDisplayData }> = {}

  function ensureLine(
    target: Record<string, { data: CommentDisplayData }>,
    lineKey: string
  ): CommentDisplayData {
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }
    return target[lineKey].data
  }

  // Build parent lookup for thread resolution
  const commentById = new Map<number, ReviewComment>()
  for (const c of existingComments) {
    if (pathMatches(c.path, filename)) commentById.set(c.id, c)
  }

  // Separate parents and replies, then process parents first
  const fileComments = existingComments.filter(c => pathMatches(c.path, filename))
  const parents = fileComments.filter(c => c.in_reply_to_id === null)
  const replies = fileComments.filter(c => c.in_reply_to_id !== null)

  for (const comment of parents) {
    if (comment.line === null) continue

    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)
    ensureLine(target, lineKey).comments.push({
      body: comment.body,
      author: comment.author,
      type: 'existing',
      createdAt: comment.created_at,
      isReply: false,
      commentId: comment.id,
    })
  }

  // Sort replies chronologically, then attach each to its parent's position
  const sortedReplies = [...replies].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  for (const reply of sortedReplies) {
    const parent = reply.in_reply_to_id !== null ? commentById.get(reply.in_reply_to_id) : undefined
    const resolvedLine = parent?.line ?? reply.line
    if (resolvedLine === null) continue

    const resolvedSide = (reply.line === null && reply.side === null && parent)
      ? parent.side
      : reply.side
    const target = sideToSplitSide(resolvedSide) === 'oldFile' ? oldFile : newFile
    const lineKey = String(resolvedLine)

    ensureLine(target, lineKey).comments.push({
      body: reply.body,
      author: reply.author,
      type: 'existing',
      createdAt: reply.created_at,
      isReply: true,
    })
  }

  for (let index = 0; index < pendingComments.length; index++) {
    const comment = pendingComments[index]
    if (!pathMatches(comment.path, filename)) continue

    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)
    ensureLine(target, lineKey).comments.push({
      body: comment.body,
      type: 'pending',
      index,
    })
  }

  // Replies queued for the pending review render under the comment they answer,
  // resolved to that comment's line/side (which must be on this file).
  for (const pendingReply of pendingReplies) {
    const parent = commentById.get(pendingReply.commentId)
    if (!parent || parent.line === null) continue

    const target = sideToSplitSide(parent.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(parent.line)
    ensureLine(target, lineKey).comments.push({
      body: pendingReply.body,
      type: 'pending-reply',
      commentId: pendingReply.commentId,
    })
  }

  for (const comment of agentComments) {
    if (comment.comment_type !== 'inline') continue
    if (comment.status === 'dismissed') continue
    if (!comment.file_path || comment.line_number === null) continue
    if (!pathMatches(comment.file_path, filename)) continue

    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line_number)
    ensureLine(target, lineKey).comments.push({
      body: comment.body,
      type: 'agent',
      commentId: comment.id,
      status: comment.status,
      filePath: comment.file_path,
      lineNumber: comment.line_number,
      commentSide: comment.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    })
  }

  // Local "Ask the AI author" threads anchored to a diff line — or to a specific
  // AI review comment (a follow-up question), which carries the same denormalized
  // location — render inline like comments. Step-anchored threads are handled by
  // the walkthrough view instead.
  for (const thread of aiThreads) {
    if (thread.anchor.type !== 'line' && thread.anchor.type !== 'comment') continue
    if (!pathMatches(thread.anchor.filename, filename)) continue
    const target = sideToSplitSide(thread.anchor.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(thread.anchor.line)
    // A comment-anchored thread is a follow-up to the AI review comment above it,
    // so nest it (reply styling) to make that relationship clear. A line-anchored
    // thread stands on its own.
    ensureLine(target, lineKey).comments.push({
      type: 'ai-thread',
      thread,
      isReply: thread.anchor.type === 'comment',
    })
  }

  return { oldFile, newFile }
}

export function prCommentsToReviewComments(prComments: PrComment[]): ReviewComment[] {
  return prComments
    .filter(c => c.file_path !== null && c.line_number !== null)
    .map(c => ({
      id: c.id,
      pr_number: 0,
      repo_owner: '',
      repo_name: '',
      path: c.file_path!,
      line: c.line_number,
      side: 'RIGHT' as string | null,
      body: c.body,
      author: c.author,
      created_at: new Date(c.created_at * 1000).toISOString(),
      in_reply_to_id: null,
    }))
}
