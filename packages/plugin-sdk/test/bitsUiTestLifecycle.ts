import { cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, expect, vi } from 'vitest'

/**
 * Drains Bits UI's delayed body scroll-lock teardown before JSDOM removes the document.
 */
export function useBitsUiBodyScrollLockTestLifecycle() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(async () => {
    try {
      cleanup()
      await tick()
      await vi.runAllTimersAsync()
      expect(vi.getTimerCount()).toBe(0)
      expect(document.body.style.overflow).not.toBe('hidden')
    } finally {
      vi.useRealTimers()
    }
  })
}
