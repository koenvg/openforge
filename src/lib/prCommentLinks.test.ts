import { describe, it, expect } from 'vitest'
import type { PrComment } from './types'
import { buildPrCommentUrl, uniqueAuthors, filterByAuthor } from './prCommentLinks'

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    pr_id: 10,
    author: 'octocat',
    body: 'body',
    comment_type: 'review_comment',
    file_path: 'src/lib.rs',
    line_number: 5,
    addressed: 0,
    outdated: 0,
    created_at: 0,
    ...overrides,
  }
}

const PR_URL = 'https://github.com/acme/repo/pull/42'

describe('buildPrCommentUrl', () => {
  it('links a review comment to its discussion anchor', () => {
    const url = buildPrCommentUrl(makeComment({ id: 123, comment_type: 'review_comment' }), PR_URL)
    expect(url).toBe(`${PR_URL}#discussion_r123`)
  })

  it('links a general issue comment to its issuecomment anchor', () => {
    const url = buildPrCommentUrl(makeComment({ id: 456, comment_type: 'issue_comment' }), PR_URL)
    expect(url).toBe(`${PR_URL}#issuecomment-456`)
  })

  it('returns null for a review body (not individually linkable)', () => {
    const url = buildPrCommentUrl(makeComment({ id: -7, comment_type: 'review_body' }), PR_URL)
    expect(url).toBeNull()
  })

  it('returns null for a negative id even if typed as a review comment', () => {
    const url = buildPrCommentUrl(makeComment({ id: -7, comment_type: 'review_comment' }), PR_URL)
    expect(url).toBeNull()
  })

  it('returns null when the PR url is empty', () => {
    const url = buildPrCommentUrl(makeComment({ id: 1 }), '')
    expect(url).toBeNull()
  })
})

describe('uniqueAuthors', () => {
  it('returns sorted unique authors', () => {
    const comments = [
      makeComment({ author: 'zed' }),
      makeComment({ author: 'ann' }),
      makeComment({ author: 'zed' }),
      makeComment({ author: 'bob' }),
    ]
    expect(uniqueAuthors(comments)).toEqual(['ann', 'bob', 'zed'])
  })

  it('returns an empty array for no comments', () => {
    expect(uniqueAuthors([])).toEqual([])
  })
})

describe('filterByAuthor', () => {
  const comments = [
    makeComment({ id: 1, author: 'ann' }),
    makeComment({ id: 2, author: 'bob' }),
    makeComment({ id: 3, author: 'ann' }),
  ]

  it('returns all comments when author is null', () => {
    expect(filterByAuthor(comments, null)).toHaveLength(3)
  })

  it('returns all comments when author is empty string', () => {
    expect(filterByAuthor(comments, '')).toHaveLength(3)
  })

  it('returns only comments from the chosen author', () => {
    const result = filterByAuthor(comments, 'ann')
    expect(result.map((c) => c.id)).toEqual([1, 3])
  })
})
