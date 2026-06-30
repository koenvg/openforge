import { describe, it, expect } from 'vitest'
import {
  countAllReposUnopenedReviews,
  countRepoUnopenedReviews,
  DO_NOT_REVIEW_LABEL,
  hasDoNotReviewLabel,
} from './prReviewBadgeCounts'
import type { ReviewPullRequest, PrLabel } from './types'

function label(name: string): PrLabel {
  return { name, color: '' }
}

function review(overrides: Partial<ReviewPullRequest>): ReviewPullRequest {
  return {
    repo_owner: 'me',
    repo_name: 'app',
    viewed_at: null,
    labels: [],
    ...overrides,
  } as ReviewPullRequest
}

describe('countAllReposUnopenedReviews', () => {
  it('counts only unopened review requests across all repos', () => {
    const count = countAllReposUnopenedReviews([
      review({ viewed_at: null }), // counts
      review({ viewed_at: 123 }), // opened — excluded
      review({ repo_owner: 'other', repo_name: 'svc', viewed_at: null }), // other repo counts
    ])
    expect(count).toBe(2)
  })

  it('excludes repos in the global exclusion set', () => {
    const count = countAllReposUnopenedReviews(
      [
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null }),
        review({ repo_owner: 'noisy', repo_name: 'repo', viewed_at: null }),
      ],
      new Set(['noisy/repo']),
    )
    expect(count).toBe(1)
  })

  it('excludes PRs labeled DO NOT REVIEW', () => {
    const count = countAllReposUnopenedReviews([
      review({ viewed_at: null, labels: [] }),
      review({ viewed_at: null, labels: [label(DO_NOT_REVIEW_LABEL)] }),
    ])
    expect(count).toBe(1)
  })

  it('is constant regardless of any per-repo state — same list, same number', () => {
    const prs = [
      review({ repo_owner: 'a', repo_name: 'x', viewed_at: null }),
      review({ repo_owner: 'b', repo_name: 'y', viewed_at: null }),
      review({ repo_owner: 'c', repo_name: 'z', viewed_at: null }),
    ]
    expect(countAllReposUnopenedReviews(prs)).toBe(3)
    expect(countAllReposUnopenedReviews(prs)).toBe(3)
  })
})

describe('countRepoUnopenedReviews', () => {
  it('returns zero when the repo is unresolved', () => {
    expect(countRepoUnopenedReviews([review({ viewed_at: null })], null)).toBe(0)
  })

  it('counts only unopened review requests in the active repo', () => {
    const count = countRepoUnopenedReviews(
      [
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null }), // counts
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: 5 }), // opened — excluded
        review({ repo_owner: 'other', repo_name: 'app', viewed_at: null }), // different repo
      ],
      'me/app',
    )
    expect(count).toBe(1)
  })

  it('excludes PRs labeled DO NOT REVIEW in the active repo', () => {
    const count = countRepoUnopenedReviews(
      [
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null, labels: [label('other')] }),
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null, labels: [label(DO_NOT_REVIEW_LABEL)] }),
      ],
      'me/app',
    )
    expect(count).toBe(1)
  })
})

describe('hasDoNotReviewLabel', () => {
  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(hasDoNotReviewLabel(review({ labels: [label('  do not review ')] }))).toBe(true)
    expect(hasDoNotReviewLabel(review({ labels: [label('DO NOT REVIEW')] }))).toBe(true)
    expect(hasDoNotReviewLabel(review({ labels: [label('needs review')] }))).toBe(false)
    expect(hasDoNotReviewLabel(review({ labels: [] }))).toBe(false)
  })
})
