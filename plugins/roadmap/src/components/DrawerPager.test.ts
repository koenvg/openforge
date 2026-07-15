import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import DrawerPager from './DrawerPager.svelte'

function renderPager(overrides: Record<string, unknown> = {}) {
  return render(DrawerPager, {
    props: {
      index: 2,
      total: 7,
      groupTitle: 'bug',
      onPrev: vi.fn(),
      onNext: vi.fn(),
      ...overrides,
    },
  })
}

describe('DrawerPager', () => {
  it('shows the 1-based position, total, and group title', () => {
    renderPager()
    expect(screen.getByText('3 of 7 · bug')).toBeTruthy()
  })

  it('calls onPrev and onNext when the arrows are clicked', async () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderPager({ onPrev, onNext })

    await fireEvent.click(screen.getByRole('button', { name: 'Previous issue in bug' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('disables both arrows for a group of one', () => {
    renderPager({ index: 0, total: 1 })
    expect(screen.getByRole('button', { name: 'Previous issue in bug' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Next issue in bug' })).toHaveProperty('disabled', true)
  })
})
