import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Alert from './Alert.svelte'

const children = createRawSnippet(() => ({ render: () => '<p>Network unavailable</p>' }))

describe('Alert public feedback', () => {
  it('leaves announcement urgency to the caller, regardless of variant', async () => {
    const { container, rerender } = render(Alert, { children, variant: 'danger', id: 'feedback', title: 'Connection' })
    const alert = container.querySelector('#feedback')!
    expect(alert.textContent).toContain('Network unavailable')
    expect(alert.getAttribute('title')).toBe('Connection')
    expect(alert.getAttribute('role')).toBeNull()
    expect(alert.getAttribute('aria-live')).toBeNull()

    await rerender({ role: 'status', 'aria-live': 'polite', 'aria-atomic': true })
    expect(screen.getByRole('status')).toBe(alert)
    expect(alert.getAttribute('aria-live')).toBe('polite')
    expect(alert.getAttribute('aria-atomic')).toBe('true')
    await rerender({ variant: 'success', role: 'alert', 'aria-live': 'assertive' })
    expect(screen.getByRole('alert')).toBe(alert)
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    await rerender({ role: undefined, 'aria-live': 'off' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(alert.getAttribute('aria-live')).toBe('off')
  })
})
