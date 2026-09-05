import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import SettingsSectionCard from './SettingsSectionCard.svelte'

const children = createRawSnippet(() => ({
  render: () => '<button type="button">Child action</button>',
}))

const actions = createRawSnippet(() => ({
  render: () => '<span>Header action</span>',
}))

describe('SettingsSectionCard', () => {
  it('provides an accessible titled group and renders header actions and content', () => {
    render(SettingsSectionCard, {
      props: {
        title: 'Example settings',
        actions,
        children,
      },
    })

    expect(screen.getByRole('group', { name: 'Example settings' })).toBeTruthy()
    expect(screen.getByText('Header action')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Child action' })).toBeTruthy()
  })

  it('exposes disabled semantics and makes the region inert', () => {
    render(SettingsSectionCard, {
      props: {
        title: 'Disabled settings',
        disabled: true,
        children,
      },
    })

    const group = screen.getByRole('group', { name: 'Disabled settings' })
    expect(group.getAttribute('aria-disabled')).toBe('true')
    expect(group.hasAttribute('inert')).toBe(true)
  })
})
