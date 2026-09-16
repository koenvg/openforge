import type { ReviewThread } from '@openforge-app/plugin-sdk'
import type { ReviewComment, ReviewSubmissionComment, PrComment } from '@openforge-app/plugin-sdk/domain'

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
  | PendingReplyCommentDisplayData
  | ThreadCommentDisplayData

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

export interface ThreadCommentDisplayData {
  type: 'thread'
  thread: ReviewThread
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

export interface BuildExtendDataOptions {
  filename: string
  existingComments?: ReviewComment[]
  pendingComments?: ReviewSubmissionComment[]
  pendingReplies?: PendingReply[]
  threads?: ReviewThread[]
}

export function buildExtendData({
  filename,
  existingComments = [],
  pendingComments = [],
  pendingReplies = [],
  threads = [],
}: BuildExtendDataOptions): {
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

  const fileComments = existingComments.filter(c => pathMatches(c.path, filename))
  const parents = fileComments.filter(c => c.in_reply_to_id === null)
  const parentIds = new Set(parents.map(parent => parent.id))
  const sortedReplies = fileComments
    .filter(c => c.in_reply_to_id !== null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const repliesByParentId = new Map<number, ReviewComment[]>()
  const orphanReplies: ReviewComment[] = []

  for (const reply of sortedReplies) {
    const parentId = reply.in_reply_to_id
    if (parentId === null || !parentIds.has(parentId)) {
      orphanReplies.push(reply)
      continue
    }
    const replies = repliesByParentId.get(parentId) ?? []
    replies.push(reply)
    repliesByParentId.set(parentId, replies)
  }

  function appendReply(reply: ReviewComment): void {
    const parent = reply.in_reply_to_id !== null ? commentById.get(reply.in_reply_to_id) : undefined
    const resolvedLine = parent?.line ?? reply.line
    if (resolvedLine === null) return

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

  for (const comment of parents) {
    if (comment.line !== null) {
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
    for (const reply of repliesByParentId.get(comment.id) ?? []) appendReply(reply)
  }

  for (const reply of orphanReplies) appendReply(reply)

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

  for (const thread of threads) {
    if (thread.anchor.kind !== 'line') continue
    if (thread.anchor.filePath !== filename) continue

    const target = sideToSplitSide(thread.anchor.side) === 'oldFile' ? oldFile : newFile
    ensureLine(target, String(thread.anchor.line)).comments.push({
      type: 'thread',
      thread,
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
      in_reply_to_id: c.in_reply_to_id,
    }))
}
