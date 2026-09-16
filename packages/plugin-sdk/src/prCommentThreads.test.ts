import { describe, expect, it } from 'vitest'
import {
  getPrCommentThreadRoots,
  getUnaddressedPrCommentThreadRoots,
  type PrComment,
} from './domain.js'

function comment(overrides: Partial<PrComment>): PrComment {
  return {
    id: 1,
    pr_id: 42,
    author: 'reviewer',
    body: 'Comment',
    comment_type: 'review_comment',
    file_path: 'src/main.ts',
    line_number: 12,
    in_reply_to_id: null,
    addressed: 0,
    outdated: 0,
    created_at: 1000,
    ...overrides,
  }
}

describe('pull request comment threads', () => {
  const reviewerRoot = comment({ id: 1, author: 'reviewer' })
  const replies = [2, 3, 4].map(id => comment({ id, author: 'author', in_reply_to_id: 1 }))
  const ownRoot = comment({ id: 5, author: 'AUTHOR' })
  const addressedRoot = comment({ id: 6, author: 'other-reviewer', addressed: 1 })
  const comments = [reviewerRoot, ...replies, ownRoot, addressedRoot]

  it('lists one root per thread', () => {
    expect(getPrCommentThreadRoots(comments)).toEqual([reviewerRoot, ownRoot, addressedRoot])
  })

  it('counts only unaddressed roots written by someone else when identity is known', () => {
    expect(getUnaddressedPrCommentThreadRoots(comments, 'author')).toEqual([reviewerRoot])
  })

  it('counts every unaddressed root when identity is unknown', () => {
    expect(getUnaddressedPrCommentThreadRoots(comments, null)).toEqual([reviewerRoot, ownRoot])
  })
})
