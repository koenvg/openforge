import { describe, it, expect } from 'vitest'
import {
  buildReviewRequestCountByProject,
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

describe('buildReviewRequestCountByProject', () => {
  it('counts unopened reviews per project scoped to its resolved repo', () => {
    const prs = [
      review({ repo_owner: 'acme', repo_name: 'web', viewed_at: null }), // web counts
      review({ repo_owner: 'acme', repo_name: 'web', viewed_at: null }), // web counts
      review({ repo_owner: 'acme', repo_name: 'web', viewed_at: 9 }), // web opened — excluded
      review({ repo_owner: 'acme', repo_name: 'api', viewed_at: null }), // api counts
    ]
    const counts = buildReviewRequestCountByProject(
      prs,
      new Map<string, string | null>([
        ['proj-web', 'acme/web'],
        ['proj-api', 'acme/api'],
      ]),
    )
    expect(counts.get('proj-web')).toBe(2)
    expect(counts.get('proj-api')).toBe(1)
  })

  it('reports zero for a project whose repo is unresolved', () => {
    const counts = buildReviewRequestCountByProject(
      [review({ viewed_at: null })],
      new Map<string, string | null>([['proj-x', null]]),
    )
    expect(counts.get('proj-x')).toBe(0)
  })

  it('excludes opened and DO NOT REVIEW PRs, matching the other badges', () => {
    const counts = buildReviewRequestCountByProject(
      [
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null, labels: [label(DO_NOT_REVIEW_LABEL)] }),
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: 3 }),
        review({ repo_owner: 'me', repo_name: 'app', viewed_at: null }), // the only one that counts
      ],
      new Map<string, string | null>([['p', 'me/app']]),
    )
    expect(counts.get('p')).toBe(1)
  })

  it('gives every project sharing a repo the same count', () => {
    const counts = buildReviewRequestCountByProject(
      [review({ repo_owner: 'me', repo_name: 'shared', viewed_at: null })],
      new Map<string, string | null>([
        ['p1', 'me/shared'],
        ['p2', 'me/shared'],
      ]),
    )
    expect(counts.get('p1')).toBe(1)
    expect(counts.get('p2')).toBe(1)
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
