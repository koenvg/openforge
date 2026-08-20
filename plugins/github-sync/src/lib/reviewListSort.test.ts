import { describe, expect, it } from 'vitest'
import { walkthroughReadyFirst } from './reviewListSort'

describe('walkthroughReadyFirst', () => {
  const prs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

  it('moves PRs whose walkthrough is ready to the front, preserving relative order', () => {
    const result = walkthroughReadyFirst(prs, new Set([2, 4]))
    expect(result.map(p => p.id)).toEqual([2, 4, 1, 3])
  })

  it('is a no-op when nothing is ready', () => {
    expect(walkthroughReadyFirst(prs, new Set()).map(p => p.id)).toEqual([1, 2, 3, 4])
  })

  it('keeps original order among ready PRs and among the rest (stable)', () => {
    const result = walkthroughReadyFirst(prs, new Set([3, 1]))
    expect(result.map(p => p.id)).toEqual([1, 3, 2, 4])
  })

  it('does not mutate the input array', () => {
    const input = [{ id: 1 }, { id: 2 }]
    walkthroughReadyFirst(input, new Set([2]))
    expect(input.map(p => p.id)).toEqual([1, 2])
  })
})
