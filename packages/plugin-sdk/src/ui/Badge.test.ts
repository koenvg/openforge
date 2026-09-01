import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Badge from './Badge.svelte'

const children = createRawSnippet(() => ({
  render: () => 'Waiting for review',
}))

describe('plugin-sdk Badge', () => {
  it('renders caller-owned content with caller-selected semantics', () => {
    render(Badge, {
      props: {
        children,
        variant: 'warning',
        role: 'status',
        title: 'Current review state',
      },
    })

    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('Waiting for review')
    expect(badge.getAttribute('title')).toBe('Current review state')
  })
})
