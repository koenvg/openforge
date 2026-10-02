import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import StatusBadge, { type StatusBadgeStatus } from './StatusBadge.svelte'

const children = createRawSnippet(() => ({
  render: () => '<span>Status label</span>',
}))

const statuses: StatusBadgeStatus[] = [
  'pending',
  'failed',
  'success',
  'in-progress',
  'in-review',
  'submitted',
  'expired',
]

describe('plugin-sdk StatusBadge', () => {
  it.each(statuses)('renders the %s status with a semantic icon', (status) => {
    render(StatusBadge, {
      props: { children, status, role: 'status', title: 'Current status' },
    })

    const badge = screen.getByRole('status')
    expect(badge.textContent?.trim()).toBe('Status label')
    expect(badge.getAttribute('title')).toBe('Current status')
    expect(badge.getAttribute('data-status')).toBe(status)
    expect(badge.querySelector(`[data-status-icon="${status}"]`)).toBeTruthy()
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('preserves caller attributes and callbacks while the mounted status changes', async () => {
    const onclick = vi.fn()
    const { rerender } = render(StatusBadge, {
      props: { children, status: 'in-progress', role: 'status', class: 'caller-badge', style: 'margin: 4px', 'data-caller': 'kept', onclick },
    })
    const badge = screen.getByRole('status')
    await rerender({ status: 'success' })

    expect(screen.getByRole('status')).toBe(badge)
    expect(badge.textContent?.trim()).toBe('Status label')
    expect(badge.getAttribute('data-status')).toBe('success')
    expect(badge.querySelector('[data-status-icon="success"]')).toBeTruthy()
    expect(badge.querySelector('[data-status-icon="in-progress"]')).toBeNull()
    expect(badge.classList.contains('caller-badge')).toBe(true)
    expect(badge.style.margin).toBe('4px')
    expect(badge.getAttribute('data-caller')).toBe('kept')
    await fireEvent.click(badge)
    expect(onclick).toHaveBeenCalledOnce()
  })
})
