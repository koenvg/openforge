import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import LoadingIndicator from './LoadingIndicator.svelte'

describe('LoadingIndicator public feedback', () => {
  it('is decorative by default and independently named when requested', async () => {
    const { container, rerender } = render(LoadingIndicator, { id: 'loading', title: 'Fetching records' })
    const indicator = container.querySelector('#loading')!
    expect(indicator.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
    expect(indicator.getAttribute('aria-live')).toBeNull()
    expect(indicator.getAttribute('title')).toBe('Fetching records')

    await rerender({ 'aria-label': 'Loading records' })
    expect(screen.getByRole('status', { name: 'Loading records' })).toBe(indicator)
    expect(indicator.getAttribute('aria-hidden')).toBeNull()

    await rerender({ decorative: true })
    expect(screen.queryByRole('status')).toBeNull()
    expect(indicator.getAttribute('aria-label')).toBeNull()
    expect(indicator.getAttribute('aria-live')).toBeNull()
  })
})
