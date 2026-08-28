import { render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import PluginPageShell from './PluginPageShell.svelte'

const header = createRawSnippet(() => ({
  render: () => '<header>Usage</header>',
}))
const children = createRawSnippet(() => ({
  render: () => '<section aria-label="Usage details">Details</section>',
}))

describe('plugin-sdk PluginPageShell', () => {
  it('composes a fixed header region before plugin-owned page content', () => {
    const { container } = render(PluginPageShell, {
      props: { header, children, class: 'usage-page' },
    })

    expect(screen.getByRole('banner').textContent).toBe('Usage')
    expect(screen.getByRole('region', { name: 'Usage details' }).textContent).toBe('Details')
    expect(container.firstElementChild?.classList.contains('usage-page')).toBe(true)
    expect(container.querySelector('header')?.compareDocumentPosition(screen.getByRole('region')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
