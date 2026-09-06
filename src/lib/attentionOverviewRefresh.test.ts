import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import { subscribeDebounced } from './attentionOverviewRefresh'

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
