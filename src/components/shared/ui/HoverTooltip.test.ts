import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HoverTooltip from './HoverTooltip.svelte'

const children = createRawSnippet(() => ({
  render: () => '<button type="button">Tooltip anchor</button>',
}))

describe('HoverTooltip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('cancels a pending hover timer when unmounted', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(HoverTooltip, {
      props: { text: 'Helpful context', children },
    })

    await fireEvent.mouseOver(screen.getByRole('button', { name: 'Tooltip anchor' }))
    const timerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 200)
    expect(timerIndex).toBeGreaterThanOrEqual(0)
    const hoverTimer = setTimeoutSpy.mock.results[timerIndex]?.value

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalledWith(hoverTimer)
  })
})
