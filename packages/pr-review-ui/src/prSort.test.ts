import { describe, expect, it } from 'vitest'
import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel, sortDoNotReviewLast } from './prSort'

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
