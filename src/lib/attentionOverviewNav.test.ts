import { describe, it, expect } from 'vitest'
import {
  isNavigableRow,
  firstNavigableIndex,
  stepFocus,
  initialFocusIndex,
  clampFocus,
  headerIndexForGroup,
} from './attentionOverviewNav'
import type { NavRowLike } from './attentionOverviewNav'

function header(groupId: string): NavRowLike {
  return { kind: 'header', group: { id: groupId } }
}
function taskRow(groupId: string): NavRowLike {
  return { kind: 'task', group: { id: groupId } }
}
function reviewRow(groupId: string): NavRowLike {
  return { kind: 'review', group: { id: groupId } }
}

const NONE: ReadonlySet<string> = new Set()

// A representative three-project layout with p2 collapsed:
// 0 header p1 (expanded)
// 1 task   p1
// 2 review p1
// 3 header p2 (collapsed — no items shown)
// 4 header p3 (expanded)
// 5 task   p3
const layout: NavRowLike[] = [
  header('p1'),
  taskRow('p1'),
  reviewRow('p1'),
  header('p2'),
  header('p3'),
  taskRow('p3'),
]
const collapsed: ReadonlySet<string> = new Set(['p2'])

describe('isNavigableRow', () => {
  it('treats tasks and reviews as navigable', () => {
    expect(isNavigableRow(taskRow('p1'), NONE)).toBe(true)
    expect(isNavigableRow(reviewRow('p1'), NONE)).toBe(true)
  })
  it('skips an expanded project header but keeps a collapsed one reachable', () => {
    expect(isNavigableRow(header('p1'), collapsed)).toBe(false)
    expect(isNavigableRow(header('p2'), collapsed)).toBe(true)
  })
})

describe('firstNavigableIndex', () => {
  it('returns the first task/review, skipping the leading expanded header', () => {
    expect(firstNavigableIndex(layout, collapsed)).toBe(1)
  })
  it('returns -1 when there are no navigable rows', () => {
    expect(firstNavigableIndex([header('p1')], NONE)).toBe(-1)
    expect(firstNavigableIndex([], NONE)).toBe(-1)
  })
})

describe('stepFocus', () => {
  it('moving down stops on a collapsed header but skips an expanded one', () => {
    // from review p1 (2), down → collapsed header p2 (3)
    expect(stepFocus(layout, 2, 1, collapsed)).toBe(3)
    // from collapsed header p2 (3), down → skip expanded header p3 (4) → task p3 (5)
    expect(stepFocus(layout, 3, 1, collapsed)).toBe(5)
  })

  it('moving up stops on a collapsed header but skips an expanded one', () => {
    // from task p3 (5), up → skip expanded header p3 (4) → collapsed header p2 (3)
    expect(stepFocus(layout, 5, -1, collapsed)).toBe(3)
  })

  it('clamps at the ends (never wraps)', () => {
    expect(stepFocus(layout, 5, 1, collapsed)).toBe(5)
    expect(stepFocus(layout, 1, -1, collapsed)).toBe(1)
  })

  it('with nothing collapsed, skips every header', () => {
    const flat = [header('a'), taskRow('a'), header('b'), taskRow('b')]
    expect(stepFocus(flat, 1, 1, NONE)).toBe(3) // skip header b
    expect(stepFocus(flat, 3, -1, NONE)).toBe(1) // skip header b
  })
})

describe('initialFocusIndex', () => {
  it('lands on the first navigable row of the active project', () => {
    expect(initialFocusIndex(layout, 'p3', collapsed)).toBe(5)
  })
  it('lands on the collapsed header when the active project is collapsed', () => {
    expect(initialFocusIndex(layout, 'p2', collapsed)).toBe(3)
  })
  it('falls back to the first navigable row when the active project is absent', () => {
    expect(initialFocusIndex(layout, 'missing', collapsed)).toBe(1)
  })
  it('returns 0 when there is nothing navigable', () => {
    expect(initialFocusIndex([header('p1')], 'p1', NONE)).toBe(0)
  })
})

describe('clampFocus', () => {
  it('keeps the index when it already points at a navigable row', () => {
    expect(clampFocus(layout, 2, collapsed)).toBe(2)
    expect(clampFocus(layout, 3, collapsed)).toBe(3) // collapsed header is navigable
  })
  it('snaps an out-of-range index back to the last navigable row', () => {
    expect(clampFocus(layout, 99, collapsed)).toBe(5)
  })
  it('snaps an expanded-header index to the nearest navigable row (preferring before)', () => {
    // index 0 is expanded header p1 → nothing before → forward to task p1 (1)
    expect(clampFocus(layout, 0, collapsed)).toBe(1)
    // index 4 is expanded header p3 → nearest before is collapsed header p2 (3)
    expect(clampFocus(layout, 4, collapsed)).toBe(3)
  })
  it('returns 0 for an empty row list', () => {
    expect(clampFocus([], 0, NONE)).toBe(0)
  })
})

describe('headerIndexForGroup', () => {
  it('finds a group header regardless of collapse state', () => {
    expect(headerIndexForGroup(layout, 'p1')).toBe(0)
    expect(headerIndexForGroup(layout, 'p2')).toBe(3)
    expect(headerIndexForGroup(layout, 'p3')).toBe(4)
  })
  it('returns -1 for an unknown group', () => {
    expect(headerIndexForGroup(layout, 'nope')).toBe(-1)
  })
})
