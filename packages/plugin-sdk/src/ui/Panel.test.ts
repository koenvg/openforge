import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Panel from './Panel.svelte'

const header = createRawSnippet(() => ({ render: () => '<h2>Review summary</h2>' }))
const children = createRawSnippet(() => ({ render: () => '<p>Two files changed.</p>' }))
const footer = createRawSnippet(() => ({ render: () => '<button type="button">Open review</button>' }))

describe('plugin-sdk Panel', () => {
  it('renders caller-owned header, body, and footer in a named section', () => {
    render(Panel, {
      props: {
        'aria-label': 'Pull request review',
        header,
        children,
        footer,
        variant: 'raised',
      },
    })

    const panel = screen.getByRole('region', { name: 'Pull request review' })
    expect(panel.querySelector('h2')?.textContent).toBe('Review summary')
    expect(panel.textContent).toContain('Two files changed.')
    expect(screen.getByRole('button', { name: 'Open review' })).toBeTruthy()
  })
})
