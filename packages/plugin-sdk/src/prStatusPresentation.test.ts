import { describe, expect, it } from 'vitest'
import { getPrStatusChips, type PrInput } from '@openforge/plugin-sdk/prStatusPresentation'

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
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'closed', variant: 'closed' }))

    expect(getPrStatusChips({ ...basePr, state: 'merged' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Merged', variant: 'merged', icon: 'check' }))
  })
})
