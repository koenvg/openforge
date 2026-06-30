import { describe, it, expect } from 'vitest'
import type { PullRequestInfo } from './types'
import { deriveTaskAttention } from './taskAttention'

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    pr_number: 123,
    ticket_id: 'AVIV-113',
    repo_owner: 'collibra',
    repo_name: 'openforge',
    title: 'PR',
    url: 'https://github.com/collibra/openforge/pull/123',
    state: 'open',
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('deriveTaskAttention', () => {
  it('returns null when there are no PRs and no waiting dependencies (calm)', () => {
    expect(deriveTaskAttention([], 0)).toBeNull()
  })

  it('surfaces blocked dependencies when otherwise calm, with pluralization', () => {
    expect(deriveTaskAttention([], 1)).toEqual({ message: 'Blocked by 1 dependency', tone: 'warning' })
    expect(deriveTaskAttention([], 2)).toEqual({ message: 'Blocked by 2 dependencies', tone: 'warning' })
  })

  it('flags merge conflicts above every other PR signal', () => {
    const pr = makePr({ mergeable_state: 'dirty', mergeable: false, unaddressed_comment_count: 3, ci_status: 'failure' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Resolve merge conflicts', tone: 'error' })
  })

  it('flags unaddressed comments above CI failures', () => {
    const pr = makePr({ unaddressed_comment_count: 2, ci_status: 'failure', mergeable_state: 'blocked' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Review PR comments before merge', tone: 'warning' })
  })

  it('flags failing CI', () => {
    const pr = makePr({ ci_status: 'failure', mergeable_state: 'blocked' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Fix failing CI checks', tone: 'error' })
  })

  it('flags requested changes', () => {
    const pr = makePr({ review_status: 'changes_requested', mergeable_state: 'blocked' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Address requested changes', tone: 'warning' })
  })

  it('flags ready to merge', () => {
    const pr = makePr({ mergeable_state: 'clean', ci_status: 'success', review_status: 'approved' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Ready to merge', tone: 'success' })
  })

  it('shows waiting-for-CI as low-priority info', () => {
    const pr = makePr({ ci_status: 'pending', review_status: 'pending', mergeable_state: 'unknown' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Waiting for CI', tone: 'info' })
  })

  it('shows waiting-for-review when CI is done but review still pending', () => {
    const pr = makePr({ ci_status: 'success', review_status: 'review_required', mergeable_state: 'blocked' })
    expect(deriveTaskAttention([pr], 0)).toEqual({ message: 'Waiting for review', tone: 'info' })
  })

  it('stays calm (null) for a merged PR with nothing left to do', () => {
    const pr = makePr({ state: 'merged', merged_at: 123, mergeable_state: 'clean', ci_status: 'success', review_status: 'approved' })
    expect(deriveTaskAttention([pr], 0)).toBeNull()
  })
})
