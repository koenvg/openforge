import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HoverTooltip from './HoverTooltip.svelte'

const children = createRawSnippet(() => ({
  render: () => '<button type="button">Tooltip anchor</button>',
}))

describe('HoverTooltip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels a pending hover timer when unmounted', async () => {
    vi.useFakeTimers()
    const { unmount } = render(HoverTooltip, {
      props: { text: 'Helpful context', children },
    })

    await fireEvent.mouseOver(screen.getByRole('button', { name: 'Tooltip anchor' }))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
