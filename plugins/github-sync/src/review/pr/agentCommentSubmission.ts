import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { AgentReviewComment, AgentReviewCommentStatus } from '../../lib/prReviewRecords'

export function approvedInlineAgentComments(agentComments: AgentReviewComment[]): AgentReviewComment[] {
  return agentComments.filter(comment =>
    comment.status === 'approved'
    && comment.comment_type === 'inline'
    && comment.file_path !== null
    && comment.line_number !== null)
}

export function agentCommentToSubmission(comment: AgentReviewComment): ReviewSubmissionComment {
  return {
    path: comment.file_path ?? '',
    line: comment.line_number ?? 0,
    side: comment.side ?? 'RIGHT',
    body: comment.body.trim(),
  }
}

/**
 * Marks the agent comments a submitted review has just posted to GitHub as
 * handled, so a refresh or a second submit cannot post them twice.
 */
export async function dismissSubmittedAgentComments(
  agentComments: AgentReviewComment[],
  updateStatus: (commentId: number, status: AgentReviewCommentStatus) => Promise<void> | void,
  onAgentCommentsChange: (comments: AgentReviewComment[]) => void,
): Promise<void> {
  const submitted = approvedInlineAgentComments(agentComments)
  if (submitted.length === 0) return
  const submittedIds = new Set(submitted.map(comment => comment.id))
  onAgentCommentsChange(agentComments.map(comment =>
    submittedIds.has(comment.id) ? { ...comment, status: 'dismissed' } : comment))
  await Promise.all(submitted.map(comment => updateStatus(comment.id, 'dismissed')))
}
