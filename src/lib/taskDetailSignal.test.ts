import { describe, it, expect } from 'vitest'
import type { PullRequestInfo } from './types'
import { deriveTaskDetailSignal } from './taskDetailSignal'

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
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    ...overrides,
  }
}

describe('deriveTaskDetailSignal', () => {
  it('returns null when there are no PRs and no waiting dependencies (calm)', () => {
    expect(deriveTaskDetailSignal([], 0)).toBeNull()
  })

  it('surfaces blocked dependencies when otherwise calm, with pluralization', () => {
    expect(deriveTaskDetailSignal([], 1)).toEqual({ message: 'Blocked by 1 dependency', tone: 'warning' })
    expect(deriveTaskDetailSignal([], 2)).toEqual({ message: 'Blocked by 2 dependencies', tone: 'warning' })
  })

  it('flags merge conflicts above every other PR signal', () => {
    const pr = makePr({ mergeable_state: 'dirty', mergeable: false, unaddressed_comment_count: 3, ci_status: 'failure' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Resolve merge conflicts', tone: 'error' })
  })

  it('flags failing CI above unaddressed comments when readiness reports a hard blocker', () => {
    const pr = makePr({ unaddressed_comment_count: 2, ci_status: 'failure', mergeable_state: 'blocked' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Fix failing CI checks', tone: 'error' })
  })

  it('flags failing CI', () => {
    const pr = makePr({ ci_status: 'failure', mergeable_state: 'blocked' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Fix failing CI checks', tone: 'error' })
  })

  it('flags requested changes', () => {
    const pr = makePr({ review_status: 'changes_requested', mergeable_state: 'blocked' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Address requested changes', tone: 'warning' })
  })

  it('flags ready to merge', () => {
    const pr = makePr({ mergeable_state: 'clean', ci_status: 'success', review_status: 'approved' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Ready to merge', tone: 'success' })
  })

  it('uses persisted ready-to-enqueue attention and lets actionable readiness outrank another blocked PR', () => {
    const blocked = makePr({ id: 1, merge_readiness_status: 'blocked', merge_readiness_action: 'resolve_blockers', merge_readiness_blockers: [{ code: 'checks_failed', message: 'Required checks are failing.' }], readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    const enqueue = makePr({ id: 2, merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    expect(deriveTaskDetailSignal([blocked, enqueue], 0)).toEqual({ message: 'Ready to enqueue', tone: 'success' })
  })

  it('uses strict merge readiness so requested changes block merge attention', () => {
    const pr = makePr({ mergeable_state: 'clean', ci_status: 'success', review_status: 'changes_requested' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Address requested changes', tone: 'warning' })
  })

  it('waits for CI instead of flagging failure before GitHub publishes any checks', () => {
    const pr = makePr({ mergeable_state: 'unstable', ci_status: 'none', review_status: 'approved' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Waiting for CI', tone: 'info' })
  })

  it('waits for CI when persisted readiness has stale no-check failure', () => {
    const pr = makePr({
      mergeable_state: 'unstable',
      ci_status: 'none',
      review_status: 'approved',
      merge_readiness_status: 'blocked',
      merge_readiness_action: 'resolve_blockers',
      merge_readiness_blockers: [{ code: 'checks_failed', message: 'GitHub reports failing or unstable required checks.' }],
      readiness_source_head_sha: 'abc',
      readiness_updated_at: 2,
      updated_at: 1,
    })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Waiting for CI', tone: 'info' })
  })

  it('does not flag ready to merge while CI is pending even when GitHub mergeability is clean', () => {
    const pr = makePr({ mergeable_state: 'clean', ci_status: 'pending', review_status: 'approved' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Waiting for CI', tone: 'info' })
  })

  it('does not flag draft PRs as ready to merge', () => {
    const pr = makePr({ mergeable_state: 'clean', ci_status: 'success', draft: true, review_status: 'approved' })
    expect(deriveTaskDetailSignal([pr], 0)).toBeNull()
  })

  it('shows waiting-for-CI as low-priority info', () => {
    const pr = makePr({ ci_status: 'pending', review_status: 'pending', mergeable_state: 'unknown' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Waiting for CI', tone: 'info' })
  })

  it('surfaces dependency blockers before passive PR waiting states', () => {
    const unknownPr = makePr({ mergeable: null, mergeable_state: 'unknown', ci_status: 'success' })
    const pendingPr = makePr({ ci_status: 'pending', review_status: 'approved', mergeable_state: 'clean' })

    expect(deriveTaskDetailSignal([unknownPr], 1)).toEqual({ message: 'Blocked by 1 dependency', tone: 'warning' })
    expect(deriveTaskDetailSignal([pendingPr], 2)).toEqual({ message: 'Blocked by 2 dependencies', tone: 'warning' })
  })

  it('surfaces later hard PR blockers before earlier passive waiting PRs', () => {
    const pendingPr = makePr({ id: 1, merge_readiness_status: 'blocked', merge_readiness_action: 'resolve_blockers', merge_readiness_blockers: [{ code: 'checks_pending', message: 'Required checks are still running.' }], readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    const conflictedPr = makePr({ id: 2, merge_readiness_status: 'blocked', merge_readiness_action: 'resolve_blockers', merge_readiness_blockers: [{ code: 'merge_conflict', message: 'Pull request has merge conflicts.' }], readiness_source_head_sha: 'abc', readiness_updated_at: 0 })

    expect(deriveTaskDetailSignal([pendingPr, conflictedPr], 0)).toEqual({ message: 'Resolve merge conflicts', tone: 'error' })
  })

  it('shows waiting-for-review when CI is done but review still pending', () => {
    const pr = makePr({ ci_status: 'success', review_status: 'review_required', mergeable_state: 'blocked' })
    expect(deriveTaskDetailSignal([pr], 0)).toEqual({ message: 'Waiting for review', tone: 'info' })
  })

  it('stays calm (null) for a merged PR with nothing left to do', () => {
    const pr = makePr({ state: 'merged', merged_at: 123, mergeable_state: 'clean', ci_status: 'success', review_status: 'approved' })
    expect(deriveTaskDetailSignal([pr], 0)).toBeNull()
  })
})
