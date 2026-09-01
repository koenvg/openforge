import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import PluginSidebarLink from './PluginSidebarLink.svelte'

const leading = createRawSnippet(() => ({ render: () => '<span data-testid="leading">L</span>' }))
const label = createRawSnippet(() => ({ render: () => '<span>Usage</span>' }))
const trailing = createRawSnippet(() => ({ render: () => '<span data-testid="trailing">82%</span>' }))

function renderLink(overrides: Record<string, unknown> = {}) {
  const onActivate = vi.fn()
  render(PluginSidebarLink, {
    props: {
      accessibleName: 'Codex usage',
      active: false,
      collapsed: false,
      onActivate,
      leading,
      label,
      trailing,
      ...overrides,
    },
  })
  return { link: screen.getByRole('button', { name: 'Codex usage' }), onActivate }
}

describe('PluginSidebarLink', () => {
  it.each([
    { key: 'Enter', label: 'Enter' },
    { key: ' ', label: 'Space' },
  ])('leaves $label activation to the native button', async ({ key }) => {
    const { link, onActivate } = renderLink()

    link.focus()
    expect(await fireEvent.keyDown(link, { key })).toBe(true)
    expect(await fireEvent.keyUp(link, { key })).toBe(true)

    expect(onActivate).not.toHaveBeenCalled()
  })

  it('activates from the click dispatched by the native button', () => {
    const { link, onActivate } = renderLink()

    link.click()

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('exposes active state and remains focusable', () => {
    const { link } = renderLink({ active: true })

    expect(link.getAttribute('aria-current')).toBe('page')
    link.focus()
    expect(document.activeElement).toBe(link)
  })

  it('uses its accessible name as the collapsed tooltip and hides label and trailing content', () => {
    const { link } = renderLink({ collapsed: true })

    expect(link.getAttribute('title')).toBe('Codex usage')
    expect(screen.getByTestId('leading')).toBeTruthy()
    expect(screen.queryByText('Usage')).toBeNull()
    expect(screen.queryByTestId('trailing')).toBeNull()
  })

  it('renders plugin-owned leading, label, and trailing content when expanded', () => {
    renderLink()

    expect(screen.getByTestId('leading')).toBeTruthy()
    expect(screen.getByText('Usage')).toBeTruthy()
    expect(screen.getByTestId('trailing')).toBeTruthy()
  })
})
