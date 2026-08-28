import { render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import PluginPageHeader from './PluginPageHeader.svelte'

const actions = createRawSnippet(() => ({
  render: () => '<button type="button">Refresh</button>',
}))

describe('plugin-sdk PluginPageHeader', () => {
  it('renders a page heading with optional descriptive and action content', async () => {
    const { rerender } = render(PluginPageHeader, {
      props: { title: 'Usage', actions },
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Usage' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(screen.queryByText('Account limits and token activity')).toBeNull()

    await rerender({
      title: 'Usage',
      subtitle: 'Account limits and token activity',
      actions,
    })

    expect(screen.getByText('Account limits and token activity')).toBeTruthy()
  })

  it('supports a nested section heading level', () => {
    render(PluginPageHeader, {
      props: { title: 'Recent activity', headingLevel: 'h2' },
    })

    expect(screen.getByRole('heading', { level: 2, name: 'Recent activity' })).toBeTruthy()
  })
})
