import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
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

  it('rotates only the progress icon and disables it for reduced-motion users', () => {
    render(StatusBadge, { props: { children, status: 'in-progress' } })

    const icon = screen.getByText('Status label').closest('[data-status-badge]')?.querySelector('svg')
    expect(icon?.classList.contains('status-badge-icon--spinning')).toBe(true)
    expect(icon?.classList.contains('motion-reduce:animate-none')).toBe(true)
  })

})
