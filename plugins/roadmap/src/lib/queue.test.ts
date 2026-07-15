import { describe, it, expect } from 'vitest'
import { stepIndex } from './queue'

const setOf = (...ns: number[]) => new Set(ns)

describe('stepIndex', () => {
  const queue = [4, 9, 12, 15]
  const allPresent = setOf(4, 9, 12, 15)

  it('moves forward one position', () => {
    expect(stepIndex(queue, 1, 1, allPresent)).toBe(2)
  })

  it('moves back one position', () => {
    expect(stepIndex(queue, 1, -1, allPresent)).toBe(0)
  })

  it('wraps forward from the last entry to the first', () => {
    expect(stepIndex(queue, 3, 1, allPresent)).toBe(0)
  })

  it('wraps back from the first entry to the last', () => {
    expect(stepIndex(queue, 0, -1, allPresent)).toBe(3)
  })

  it('skips an issue that has left the board', () => {
    // 12 is gone, so stepping forward from 9 lands on 15.
    expect(stepIndex(queue, 1, 1, setOf(4, 9, 15))).toBe(3)
  })

  it('skips across the wrap boundary', () => {
    // From 12: 15 and 4 are gone, so it wraps past both and lands on 9.
    expect(stepIndex(queue, 2, 1, setOf(9, 12))).toBe(1)
  })

  it('returns the current index when it is the only survivor', () => {
    expect(stepIndex(queue, 2, 1, setOf(12))).toBe(2)
  })

  it('returns null when nothing in the queue is still on the board', () => {
    expect(stepIndex(queue, 2, 1, setOf())).toBe(null)
  })

  it('returns the only index for a single-item queue', () => {
    expect(stepIndex([12], 0, 1, setOf(12))).toBe(0)
  })

  it('returns null for an empty queue', () => {
    expect(stepIndex([], 0, 1, setOf(12))).toBe(null)
  })
})
