import { describe, expect, it } from 'vitest'

import { isNearBottom } from './developerLogsScroll'

describe('isNearBottom', () => {
  const THRESHOLD = 32

  it('is true when scrolled exactly to the bottom', () => {
    // scrollHeight 1000, viewport 400 -> max scrollTop is 600.
    expect(isNearBottom(600, 1000, 400, THRESHOLD)).toBe(true)
  })

  it('is true when within the threshold of the bottom', () => {
    // 20px from the bottom, threshold 32 -> still pinned.
    expect(isNearBottom(580, 1000, 400, THRESHOLD)).toBe(true)
  })

  it('is true at exactly the threshold distance from the bottom', () => {
    // 32px from the bottom == threshold -> pinned (inclusive).
    expect(isNearBottom(568, 1000, 400, THRESHOLD)).toBe(true)
  })

  it('is false when scrolled up beyond the threshold', () => {
    // 100px from the bottom -> user is reading history, do not auto-scroll.
    expect(isNearBottom(500, 1000, 400, THRESHOLD)).toBe(false)
  })

  it('is true when content is shorter than the viewport (nothing to scroll)', () => {
    // scrollHeight <= clientHeight, scrollTop 0 -> considered pinned.
    expect(isNearBottom(0, 200, 400, THRESHOLD)).toBe(true)
  })

  it('is true when overscrolled past the bottom (scrollTop exceeds max)', () => {
    // Elastic/overscroll can push scrollTop beyond the max; still pinned.
    expect(isNearBottom(650, 1000, 400, THRESHOLD)).toBe(true)
  })

  it('is true at the bottom with a zero threshold', () => {
    expect(isNearBottom(600, 1000, 400, 0)).toBe(true)
  })

  it('is false one pixel above the bottom with a zero threshold', () => {
    expect(isNearBottom(599, 1000, 400, 0)).toBe(false)
  })
})
