import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'
import { setupCommandHeldListeners } from './useCommandHeld.svelte'
import { commandHeld } from './stores'

describe('useCommandHeld', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    commandHeld.set(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sets commandHeld to true after 150ms when Meta is held', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
    expect(get(commandHeld)).toBe(false)

    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(true)

    cleanup()
  })

  it('sets commandHeld to false immediately on Meta keyup', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })

  it('does NOT set commandHeld true when Meta is quickly released before debounce', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
    expect(get(commandHeld)).toBe(false)

    vi.advanceTimersByTime(100)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
    expect(get(commandHeld)).toBe(false)

    vi.advanceTimersByTime(100)
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })

  it('resets commandHeld to false on window blur', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(true)

    window.dispatchEvent(new Event('blur'))
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })

  it('ignores repeated keydown events (e.repeat = true)', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', repeat: false }))
    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', repeat: true }))
    expect(get(commandHeld)).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })

  it('ignores non-Meta keys', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }))
    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })

  it('resets commandHeld to false on document visibility change (hidden)', () => {
    const cleanup = setupCommandHeldListeners()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
    vi.advanceTimersByTime(150)
    expect(get(commandHeld)).toBe(true)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    document.dispatchEvent(new Event('visibilitychange'))
    expect(get(commandHeld)).toBe(false)

    cleanup()
  })
})
