import { describe, expect, it } from 'vitest'
import {
  DO_NOT_REVIEW_LABEL,
  authoredPrNeedsAttention,
  hasDoNotReviewLabel,
  sortAuthoredPrs,
  sortDoNotReviewLast,
} from './prSort'

const mk = (id: number, labels: { name: string; color: string }[] = []) => ({ id, labels })

describe('sortDoNotReviewLast', () => {
  it('moves a DO NOT REVIEW PR to the end of the list', () => {
    const prs = [mk(1, [{ name: 'DO NOT REVIEW', color: 'b60205' }]), mk(2), mk(3)]
    expect(sortDoNotReviewLast(prs).map((p) => p.id)).toEqual([2, 3, 1])
  })

  it('matches the label case-insensitively and trimmed', () => {
    const prs = [mk(1, [{ name: '  do not review  ', color: 'b60205' }]), mk(2)]
    expect(sortDoNotReviewLast(prs).map((p) => p.id)).toEqual([2, 1])
  })

  it('preserves relative order among non-labeled and among labeled PRs (stable)', () => {
    const prs = [
      mk(1, [{ name: 'DO NOT REVIEW', color: 'b60205' }]),
      mk(2),
      mk(3, [{ name: 'DO NOT REVIEW', color: 'b60205' }]),
      mk(4),
    ]
    expect(sortDoNotReviewLast(prs).map((p) => p.id)).toEqual([2, 4, 1, 3])
  })

  it('leaves a list without the label unchanged', () => {
    const prs = [mk(1, [{ name: 'bug', color: 'd73a4a' }]), mk(2), mk(3)]
    expect(sortDoNotReviewLast(prs).map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('does not mutate the input array', () => {
    const prs = [mk(1, [{ name: 'DO NOT REVIEW', color: 'b60205' }]), mk(2)]
    const snapshot = prs.map((p) => p.id)
    sortDoNotReviewLast(prs)
    expect(prs.map((p) => p.id)).toEqual(snapshot)
  })
})

/** Builds an authored PR that is open, non-draft, and healthy; override to vary one axis. */
const authored = (
  id: number,
  overrides: Partial<{
    state: string
    draft: boolean
    mergeable_state: string | null
    ci_status: string | null
    review_status: string | null
    labels: { name: string; color: string }[]
  }> = {},
) => ({
  id,
  state: 'open',
  draft: false,
  mergeable_state: 'clean',
  ci_status: 'success',
  review_status: 'review_required',
  labels: [],
  ...overrides,
})

describe('authoredPrNeedsAttention', () => {
  it('is true when the PR conflicts with its base branch', () => {
    expect(authoredPrNeedsAttention(authored(1, { mergeable_state: 'dirty' }))).toBe(true)
    expect(authoredPrNeedsAttention(authored(2, { mergeable_state: 'conflicting' }))).toBe(true)
  })

  it('is true when checks failed', () => {
    expect(authoredPrNeedsAttention(authored(1, { ci_status: 'failure' }))).toBe(true)
  })

  it('is true when a reviewer requested changes', () => {
    expect(authoredPrNeedsAttention(authored(1, { review_status: 'changes_requested' }))).toBe(true)
  })

  it('is false for a healthy open PR', () => {
    expect(authoredPrNeedsAttention(authored(1))).toBe(false)
  })

  it('is false while checks are still running or review is merely awaited', () => {
    expect(authoredPrNeedsAttention(authored(1, { ci_status: 'pending' }))).toBe(false)
    expect(authoredPrNeedsAttention(authored(2, { review_status: 'review_required' }))).toBe(false)
    expect(authoredPrNeedsAttention(authored(3, { ci_status: null, review_status: null }))).toBe(false)
  })

  it('is false for a PR that is no longer open, whatever its status fields say', () => {
    expect(
      authoredPrNeedsAttention(
        authored(1, { state: 'closed', mergeable_state: 'dirty', ci_status: 'failure' }),
      ),
    ).toBe(false)
    expect(
      authoredPrNeedsAttention(
        authored(2, { state: 'merged', review_status: 'changes_requested' }),
      ),
    ).toBe(false)
  })
})

describe('sortAuthoredPrs', () => {
  it('ranks active-needs-attention above active-healthy', () => {
    const prs = [authored(1), authored(2, { ci_status: 'failure' })]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([2, 1])
  })

  it('ranks active-healthy above draft-needs-attention', () => {
    const prs = [authored(1, { draft: true, mergeable_state: 'dirty' }), authored(2)]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([2, 1])
  })

  it('ranks draft-needs-attention above draft-healthy', () => {
    const prs = [authored(1, { draft: true }), authored(2, { draft: true, ci_status: 'failure' })]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([2, 1])
  })

  it('orders all four bands together', () => {
    const prs = [
      authored(1, { draft: true }),
      authored(2),
      authored(3, { draft: true, ci_status: 'failure' }),
      authored(4, { mergeable_state: 'dirty' }),
    ]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([4, 2, 3, 1])
  })

  it('promotes on any single attention trigger', () => {
    for (const trigger of [
      { mergeable_state: 'dirty' },
      { ci_status: 'failure' },
      { review_status: 'changes_requested' },
    ]) {
      const prs = [authored(1), authored(2, trigger)]
      expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([2, 1])
    }
  })

  it('preserves input order within a band (stable)', () => {
    const prs = [authored(1), authored(2), authored(3, { ci_status: 'failure' }), authored(4)]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([3, 1, 2, 4])
  })

  it('ignores the DO NOT REVIEW label entirely', () => {
    const labels = [{ name: DO_NOT_REVIEW_LABEL, color: 'b60205' }]
    const prs = [authored(1, { draft: true }), authored(2, { labels })]
    expect(sortAuthoredPrs(prs).map((p) => p.id)).toEqual([2, 1])
  })

  it('does not mutate the input array', () => {
    const prs = [authored(1), authored(2, { ci_status: 'failure' })]
    const snapshot = prs.map((p) => p.id)
    sortAuthoredPrs(prs)
    expect(prs.map((p) => p.id)).toEqual(snapshot)
  })
})

describe('hasDoNotReviewLabel', () => {
  it('is true only when a DO NOT REVIEW label is present', () => {
    expect(hasDoNotReviewLabel(mk(1, [{ name: 'DO NOT REVIEW', color: 'b60205' }]))).toBe(true)
    expect(hasDoNotReviewLabel(mk(2, [{ name: 'bug', color: 'd73a4a' }]))).toBe(false)
    expect(hasDoNotReviewLabel(mk(3))).toBe(false)
  })

  it('exposes the hard-coded label constant', () => {
    expect(DO_NOT_REVIEW_LABEL).toBe('DO NOT REVIEW')
  })
})
