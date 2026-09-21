import { describe, expect, it } from 'vitest'
import { getPrStatusBadgeStatus, getPrStatusChips, getReviewRequestProgress, type PrInput, type PrStatusChipSpec } from '@openforge-app/plugin-sdk/prStatusPresentation'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

describe('getPrStatusChips shared package API', () => {
  const basePr: PrInput = {
    state: 'open',
    mergeable: null,
    mergeable_state: null,
    draft: false,
    is_queued: false,
    ci_status: null,
    review_status: null,
  }

  it('preserves existing CI and review chip semantics', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Passed', variant: 'success' }))

    expect(getPrStatusChips({ ...basePr, ci_status: 'failure' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'Failing', icon: 'cross', variant: 'error' }))

    expect(getPrStatusChips({ ...basePr, review_status: 'pending' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'review', label: 'Needs Review', variant: 'neutral' }))
  })

  it('preserves existing merge readiness chip semantics', () => {
    expect(getPrStatusChips({ ...basePr, is_queued: true }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Queued Pull Request', variant: 'done', icon: 'check' }))

    expect(getPrStatusChips({ ...basePr, mergeable_state: 'clean' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Ready to Merge', variant: 'done' }))

    expect(getPrStatusChips({ ...basePr, mergeable_state: 'dirty' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Merge Conflict', variant: 'error', icon: 'cross' }))

    expect(getPrStatusChips({ ...basePr, head_sha: 'sha', updated_at: 10, merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'sha', readiness_updated_at: 10 }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Ready to Enqueue', variant: 'done', icon: 'check' }))

    expect(getPrStatusChips({ ...basePr, head_sha: 'sha', updated_at: 10, merge_readiness_status: 'readiness_unknown', merge_readiness_action: 'wait_for_github', readiness_source_head_sha: 'sha', readiness_updated_at: 10 }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Readiness Unknown', variant: 'neutral', icon: 'clock' }))
  })

  it('presents closed pull requests distinctly from merged pull requests', () => {
    expect(getPrStatusChips({ ...basePr, state: 'closed' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Closed', variant: 'closed', icon: 'cross' }))

    expect(getPrStatusChips({ ...basePr, state: 'closed' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Closed', variant: 'closed', icon: 'cross' }))

    expect(getPrStatusChips({ ...basePr, state: 'merged' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Merged', variant: 'merged', icon: 'check' }))
  })

  it('presents review-request CI and terminal outcomes through the shared helper', () => {
    const reviewPr: ReviewPullRequest = {
      id: 42,
      number: 7,
      title: 'Review this',
      body: null,
      state: 'open',
      draft: false,
      html_url: 'https://github.com/acme/widgets/pull/7',
      user_login: 'octocat',
      user_avatar_url: null,
      repo_owner: 'acme',
      repo_name: 'widgets',
      head_ref: 'feature/review-sync',
      base_ref: 'main',
      head_sha: 'abc123',
      additions: 12,
      deletions: 3,
      changed_files: 2,
      ci_status: null,
      mergeable: null,
      mergeable_state: null,
      merged_at: null,
      created_at: 1,
      updated_at: 2,
      viewed_at: null,
      viewed_head_sha: null,
      reviewed_head_sha: null,
      labels: [],
    }

    for (const [ci_status, label] of [
      ['success', 'CI Passed'],
      ['failure', 'CI Failed'],
      ['pending', 'CI Pending'],
    ] as const) {
      expect(getPrStatusChips({ ...reviewPr, ci_status }, 'compact'))
        .toContainEqual(expect.objectContaining({ type: 'ci', label }))
    }
    expect(getPrStatusChips({ ...reviewPr, ci_status: 'none' }, 'compact'))
      .not.toContainEqual(expect.objectContaining({ type: 'ci' }))

    expect(getPrStatusChips({
      ...reviewPr,
      state: 'closed',
      merged_at: 1_700_000_000,
      ci_status: 'failure',
      mergeable_state: 'clean',
    }, 'compact')).toEqual([
      expect.objectContaining({ type: 'merge', label: 'Merged', icon: 'check' }),
    ])
    expect(getPrStatusChips({
      ...reviewPr,
      state: 'closed',
      ci_status: 'pending',
      mergeable_state: 'clean',
    }, 'compact')).toEqual([
      expect.objectContaining({ type: 'merge', label: 'Closed', icon: 'cross' }),
    ])
  })

  it('maps pull request signals onto SDK status badge states', () => {
    const chip = (type: PrStatusChipSpec['type'], variant: PrStatusChipSpec['variant']): PrStatusChipSpec => ({
      type,
      variant,
      label: 'Status',
      surface: 'compact',
    })

    expect(getPrStatusBadgeStatus(chip('ci', 'pending'))).toBe('in-progress')
    expect(getPrStatusBadgeStatus(chip('ci', 'error'))).toBe('failed')
    expect(getPrStatusBadgeStatus(chip('review', 'neutral'))).toBe('in-review')
    expect(getPrStatusBadgeStatus(chip('merge', 'done'))).toBe('success')
    expect(getPrStatusBadgeStatus(chip('merge', 'closed'))).toBe('expired')
    expect(getPrStatusBadgeStatus(chip('draft', 'muted'))).toBeNull()
  })
})

describe('getReviewRequestProgress', () => {
  const open = {
    state: 'open',
    merged_at: null,
    head_sha: 'current',
    reviewed_head_sha: null,
  }

  it('reports an unreviewed current head as review needed', () => {
    expect(getReviewRequestProgress(open)).toEqual(expect.objectContaining({
      kind: 'review-needed',
      label: 'Review needed',
    }))
  })

  it('reports a matching reviewed head as reviewed', () => {
    expect(getReviewRequestProgress({ ...open, reviewed_head_sha: 'current' })).toEqual(expect.objectContaining({
      kind: 'reviewed',
      label: 'Reviewed',
    }))
  })

  it('reports a different reviewed head as updated since review', () => {
    expect(getReviewRequestProgress({ ...open, reviewed_head_sha: 'previous' })).toEqual(expect.objectContaining({
      kind: 'updated-since-review',
      label: 'Updated since review',
    }))
  })

  it('suppresses open review progress for closed and merged pull requests', () => {
    expect(getReviewRequestProgress({ ...open, state: 'closed' })).toBeNull()
    expect(getReviewRequestProgress({ ...open, state: 'merged' })).toBeNull()
    expect(getReviewRequestProgress({ ...open, state: 'closed', merged_at: 1 })).toBeNull()
  })
})
