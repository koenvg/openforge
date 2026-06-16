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
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'In Merge Queue', variant: 'done', icon: 'check' }))

    expect(getPrStatusChips({ ...basePr, mergeable_state: 'clean' }, 'compact'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Ready to Merge', variant: 'done' }))

    expect(getPrStatusChips({ ...basePr, mergeable_state: 'dirty' }, 'detail'))
      .toContainEqual(expect.objectContaining({ type: 'merge', label: 'Merge Conflict', variant: 'error', icon: 'cross' }))
  })
})
