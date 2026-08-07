import type { PrComment } from './types'

/**
 * Build a link to the original comment on GitHub.
 *
 * Review comments anchor to `#discussion_r<id>`, general issue comments to
 * `#issuecomment-<id>`. Review bodies (stored with a negated id) and any
 * comment without a real positive GitHub id are not individually linkable and
 * return `null`, as does an empty PR url.
 */
export function buildPrCommentUrl(comment: PrComment, prUrl: string): string | null {
  if (!prUrl || comment.id <= 0) {
    return null
  }
  switch (comment.comment_type) {
    case 'review_comment':
      return `${prUrl}#discussion_r${comment.id}`
    case 'issue_comment':
      return `${prUrl}#issuecomment-${comment.id}`
    default:
      return null
  }
}

/** Distinct comment authors, sorted alphabetically. */
export function uniqueAuthors(comments: PrComment[]): string[] {
  return Array.from(new Set(comments.map((c) => c.author))).sort()
}

/** Filter comments to a single author; a null/empty author returns all. */
export function filterByAuthor(comments: PrComment[], author: string | null): PrComment[] {
  if (!author) {
    return comments
  }
  return comments.filter((c) => c.author === author)
}
