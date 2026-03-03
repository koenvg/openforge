import type { ReviewComment, ReviewSubmissionComment, AgentReviewComment } from './types'

/**
 * Display data for comments on a single line.
 * Used by @git-diff-view/svelte ExtendData for inline annotations.
 */
export interface CommentDisplayData {
  comments: Array<{
    body: string
    author?: string
    type: 'existing' | 'pending' | 'agent'
    createdAt?: string
    index?: number // For pending comment deletion
    commentId?: number // DB id for agent comments
    status?: string // 'pending' | 'approved' | 'dismissed' for agent comments
    filePath?: string // original file path for agent comments
    lineNumber?: number // original line number for agent comments
    commentSide?: string // original side for agent comments
  }>
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

/**
 * Builds ExtendData-compatible objects from comment arrays.
 * Transforms ReviewComment[] and ReviewSubmissionComment[] into the per-file,
 * per-line data structure that @git-diff-view/svelte uses for inline annotations.
 *
 * @param filename - The target filename to filter comments for
 * @param existingComments - Array of ReviewComment objects from GitHub
 * @param pendingComments - Array of ReviewSubmissionComment objects (pending submission)
 * @returns Object with oldFile and newFile keys, each containing line-keyed comment data
 */
export function buildExtendData(
  filename: string,
  existingComments: ReviewComment[],
  pendingComments: ReviewSubmissionComment[],
  agentComments: AgentReviewComment[] = []
): {
  oldFile: Record<string, { data: CommentDisplayData }>
  newFile: Record<string, { data: CommentDisplayData }>
} {
  const oldFile: Record<string, { data: CommentDisplayData }> = {}
  const newFile: Record<string, { data: CommentDisplayData }> = {}

  // Process existing comments
  for (const comment of existingComments) {
    // Skip general comments (no line number)
    if (comment.line === null) continue

    // Skip comments for other files
    if (!pathMatches(comment.path, filename)) continue

    // Determine target object (oldFile or newFile)
    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)

    // Initialize or append to the line's comment data
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }

    target[lineKey].data.comments.push({
      body: comment.body,
      author: comment.author,
      type: 'existing',
      createdAt: comment.created_at
    })
  }

  // Process pending comments
  for (let index = 0; index < pendingComments.length; index++) {
    const comment = pendingComments[index]

    // Skip comments for other files
    if (!pathMatches(comment.path, filename)) continue

    // Determine target object (oldFile or newFile)
    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line)

    // Initialize or append to the line's comment data
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }

    target[lineKey].data.comments.push({
      body: comment.body,
      type: 'pending',
      index
    })
  }

  // Process agent comments
  for (const comment of agentComments) {
    // Skip non-inline comments (summaries)
    if (comment.comment_type !== 'inline') continue
    // Skip dismissed comments
    if (comment.status === 'dismissed') continue
    // Skip comments without file/line
    if (!comment.file_path || comment.line_number === null) continue
    // Skip comments for other files
    if (!pathMatches(comment.file_path, filename)) continue
    
    const target = sideToSplitSide(comment.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(comment.line_number)
    
    if (!target[lineKey]) {
      target[lineKey] = { data: { comments: [] } }
    }
    
    target[lineKey].data.comments.push({
      body: comment.body,
      type: 'agent',
      commentId: comment.id,
      status: comment.status,
      filePath: comment.file_path,
      lineNumber: comment.line_number,
      commentSide: comment.side ?? 'RIGHT'
    })
  }

  return { oldFile, newFile }
}
