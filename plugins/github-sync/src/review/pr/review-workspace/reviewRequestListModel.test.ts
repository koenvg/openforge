import { describe, expect, it } from 'vitest'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { deriveReviewRequestCollections } from './reviewRequestListModel'

const basePr: ReviewPullRequest = {
  id: 1,
  number: 42,
  title: 'Review me',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/app/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'app',
  head_ref: 'feature',
  base_ref: 'main',
  head_sha: 'head-1',
  additions: 1,
  deletions: 0,
  changed_files: 1,
  ci_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  created_at: 1,
  updated_at: 1,
  viewed_at: null,
  viewed_head_sha: null,
  reviewed_head_sha: null,
  labels: [],
}

describe('deriveReviewRequestCollections', () => {
  it('partitions by review progress, preserves repository groups, and navigates only work items', () => {
    const reviewNeeded = basePr
    const updatedSinceReview = {
      ...basePr,
      id: 2,
      number: 43,
      title: 'Updated work',
      repo_name: 'api',
      head_sha: 'head-2',
      reviewed_head_sha: 'head-1',
    }
    const reviewed = {
      ...basePr,
      id: 3,
      number: 44,
      title: 'Done',
      reviewed_head_sha: 'head-1',
    }
    const finished = {
      ...basePr,
      id: 4,
      number: 45,
      title: 'Merged',
      state: 'merged',
      merged_at: 10,
      reviewed_head_sha: 'head-1',
    }

    const result = deriveReviewRequestCollections([
      reviewNeeded,
      updatedSinceReview,
      reviewed,
      finished,
    ])

    expect(result.needsReview).toEqual([reviewNeeded, updatedSinceReview])
    expect(result.reviewed).toEqual([reviewed])
    expect(result.finished).toEqual([finished])
    expect(result.counts).toEqual({ needsReview: 2, reviewed: 1, finished: 1 })
    expect([...result.groupedNeedsReview]).toEqual([
      ['acme/app', [reviewNeeded]],
      ['acme/api', [updatedSinceReview]],
    ])
    expect([...result.groupedReviewed]).toEqual([['acme/app', [reviewed]]])
    expect([...result.groupedFinished]).toEqual([['acme/app', [finished]]])
    expect(result.keyboardNavigable).toEqual([reviewNeeded, updatedSinceReview])
  })

  it('moves only a reviewed row with a new head back to needs review', () => {
    const unchanged = { ...basePr, reviewed_head_sha: 'head-1' }
    const changed = {
      ...basePr,
      id: 2,
      number: 43,
      head_sha: 'head-2',
      reviewed_head_sha: 'head-1',
    }

    const result = deriveReviewRequestCollections([unchanged, changed])

    expect(result.reviewed).toEqual([unchanged])
    expect(result.needsReview).toEqual([changed])
    expect(result.keyboardNavigable).toEqual([changed])
  })
})
