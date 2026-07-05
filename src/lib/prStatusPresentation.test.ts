import { describe, it, expect } from 'vitest';
import { getPrStatusChips } from '@openforge-app/plugin-sdk/prStatusPresentation';
import type { PullRequestInfo } from './types';

describe('getPrStatusChips', () => {
  const basePr = {
    id: 1,
    ticket_id: 'T-1',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'title',
    url: 'url',
    state: 'open',
    head_sha: 'sha',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
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
  } as PullRequestInfo;

  it('handles ci_status in compact surface', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Passed', variant: 'success' }));
    
    expect(getPrStatusChips({ ...basePr, ci_status: 'failure' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Failed', variant: 'error' }));
      
    expect(getPrStatusChips({ ...basePr, ci_status: 'pending' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'CI Pending', variant: 'pending' }));
  });

  it('handles ci_status in detail surface', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'ci', label: 'Passing', icon: 'check', variant: 'success' }));
  });

  it('normalizes review_status pending and review_required', () => {
    const compactPending = getPrStatusChips({ ...basePr, review_status: 'pending' }, 'compact');
    const compactReq = getPrStatusChips({ ...basePr, review_status: 'review_required' }, 'compact');
    
    expect(compactPending).toContainEqual(expect.objectContaining({ type: 'review', label: 'Needs Review', variant: 'neutral' }));
    expect(compactReq).toContainEqual(expect.objectContaining({ type: 'review', label: 'Needs Review', variant: 'neutral' }));
  });

  it('handles draft state', () => {
    expect(getPrStatusChips({ ...basePr, draft: true }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'draft', label: 'Draft', variant: 'muted' }));
  });

  it('only shows Ready to Merge when user-initiated merge is allowed', () => {
    expect(getPrStatusChips({ ...basePr, ci_status: 'success', mergeable: true, mergeable_state: 'clean' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Ready to Merge', variant: 'done' }));

    for (const pr of [
      { ...basePr, ci_status: 'pending', mergeable: true, mergeable_state: 'clean' },
      { ...basePr, draft: true, ci_status: 'success', mergeable: true, mergeable_state: 'clean' },
      { ...basePr, ci_status: 'success', mergeable: null, mergeable_state: 'unknown' },
      { ...basePr, ci_status: 'success', mergeable: null, mergeable_state: null },
    ]) {
      expect(getPrStatusChips(pr, 'detail').some((chip) => chip.type === 'merge' && chip.label === 'Ready to Merge')).toBe(false);
    }
  });

  it('shows queued status instead of Ready to Merge for queued pull requests', () => {
    const chips = getPrStatusChips({ ...basePr, is_queued: true, ci_status: 'success', mergeable: true, mergeable_state: 'clean' }, 'detail');

    expect(chips).toContainEqual(expect.objectContaining({ type: 'merge', label: 'Queued Pull Request', variant: 'done' }));
    expect(chips.some((chip) => chip.type === 'merge' && chip.label === 'Ready to Merge')).toBe(false);
  });

  it('shows persisted Ready to Enqueue and Readiness Unknown details', () => {
    expect(getPrStatusChips({ ...basePr, merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'sha', readiness_updated_at: 0 }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Ready to Enqueue', variant: 'done' }));

    expect(getPrStatusChips({ ...basePr, merge_readiness_status: 'readiness_unknown', merge_readiness_action: 'wait_for_github', readiness_source_head_sha: 'sha', readiness_updated_at: 0 }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Readiness Unknown', variant: 'neutral', icon: 'clock' }));
  });

  it('presents closed pull requests separately from merged/done status', () => {
    expect(getPrStatusChips({ ...basePr, state: 'closed', merged_at: null }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Closed', variant: 'closed', icon: 'cross' }));

    expect(getPrStatusChips({ ...basePr, state: 'closed', merged_at: null }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'closed', variant: 'closed' }));
  });

  it('keeps merged pull request presentation as merged/done status', () => {
    expect(getPrStatusChips({ ...basePr, state: 'merged', merged_at: 3000 }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Merged', variant: 'merged', icon: 'check' }));

    expect(getPrStatusChips({ ...basePr, state: 'merged', merged_at: 3000 }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'merged', variant: 'merged' }));
  });

  it('ignores null and none statuses', () => {
    const chips = getPrStatusChips({ ...basePr, ci_status: 'none', review_status: null }, 'compact');
    expect(chips.some(c => c.type === 'ci')).toBe(false);
    expect(chips.some(c => c.type === 'review')).toBe(false);
  });
});
