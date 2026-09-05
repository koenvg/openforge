import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Badge from './Badge.svelte'

const children = createRawSnippet(() => ({
  render: () => 'Waiting for review',
}))

const pluginSdkRoot = process.cwd().endsWith('packages/plugin-sdk') ? process.cwd() : resolve(process.cwd(), 'packages/plugin-sdk')
const badgeSource = readFileSync(resolve(pluginSdkRoot, 'src/ui/Badge.svelte'), 'utf8')

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

  it.each(['status-neutral', 'status-running', 'status-warning', 'status-danger', 'status-success'] as const)(
    'exposes the %s domain-status variant',
    (variant) => {
      render(Badge, {
        props: { children, variant, role: 'status' },
      })

      expect(screen.getByRole('status').getAttribute('data-variant')).toBe(variant)
    },
  )

  it.each(['neutral', 'running', 'warning', 'danger', 'success'] as const)(
    'binds the %s domain status to the dedicated status token family',
    (status) => {
      expect(badgeSource).toContain(`span[data-variant='status-${status}']`)
      expect(badgeSource).toContain(`border-color: var(--of-status-${status})`)
      expect(badgeSource).toContain(`background: var(--of-status-${status}-subtle)`)
      expect(badgeSource).toContain(`color: var(--of-on-status-${status})`)
    },
  )
})
