import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import { resolveFocusedIndex, subscribeDebounced } from './attentionOverviewRefresh'

describe('resolveFocusedIndex', () => {
  it('keeps the cursor on the same logical row when it moved to a new index', () => {
    // Row 'task:b' was focused at index 1; after refresh a new row was inserted
    // above it, pushing it to index 2. The cursor should follow the row.
    const next = ['header:p1', 'task:a', 'task:b']
    expect(resolveFocusedIndex('task:b', next, 1)).toBe(2)
  })

  it('clamps to the previous index when the focused row is gone', () => {
    // 'task:b' disappeared (its agent finished); fall back to the same slot,
    // clamped into the shorter list.
    const next = ['header:p1', 'task:a']
    expect(resolveFocusedIndex('task:b', next, 5)).toBe(1)
  })

  it('returns 0 when there are no rows left', () => {
    expect(resolveFocusedIndex('task:b', [], 3)).toBe(0)
  })

  it('clamps the previous index when there is no previous key', () => {
    const next = ['header:p1', 'task:a', 'task:b']
    expect(resolveFocusedIndex(null, next, 1)).toBe(1)
  })
})

describe('subscribeDebounced', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not fire on the initial synchronous subscription emission', () => {
    const a = writable(0)
    const b = writable('x')
    const onChange = vi.fn()

    const teardown = subscribeDebounced([a, b], onChange, 250)
    vi.advanceTimersByTime(1000)

    expect(onChange).not.toHaveBeenCalled()
    teardown()
  })

  it('fires once, after the delay, when a store changes', () => {
    const a = writable(0)
    const onChange = vi.fn()
    const teardown = subscribeDebounced([a], onChange, 250)

    a.set(1)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)

    teardown()
  })

  it('coalesces a burst of changes into a single call', () => {
    const a = writable(0)
    const b = writable(0)
    const onChange = vi.fn()
    const teardown = subscribeDebounced([a, b], onChange, 250)

    a.set(1)
    b.set(1)
    a.set(2)
    vi.advanceTimersByTime(250)

    expect(onChange).toHaveBeenCalledTimes(1)
    teardown()
  })

  it('stops firing after teardown and cancels a pending call', () => {
    const a = writable(0)
    const onChange = vi.fn()
    const teardown = subscribeDebounced([a], onChange, 250)

    a.set(1) // schedules a call
    teardown() // must cancel it and unsubscribe
    vi.advanceTimersByTime(1000)
    a.set(2) // no longer subscribed

    expect(onChange).not.toHaveBeenCalled()
  })
})
