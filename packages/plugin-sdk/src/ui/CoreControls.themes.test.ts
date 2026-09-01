import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_CSS_PROPERTIES } from '../../../../src/lib/themeContract'
import CoreControlsThemeFixture from './CoreControlsThemeFixture.svelte'

describe.each(['light', 'dark', 'custom'] as const)('plugin-sdk core controls in the %s token fixture', (theme) => {
  it('keeps native semantics and accessible names', () => {
    const { container } = render(CoreControlsThemeFixture, { props: { theme } })

    const fixture = container.querySelector<HTMLElement>(`[data-theme-fixture="${theme}"]`)
    const canonicalProperties = new Set<string>(Object.values(THEME_TOKEN_CSS_PROPERTIES))

    expect(fixture).toBeTruthy()
    expect([...fixture!.style].filter((property) => property.startsWith('--of-') && !canonicalProperties.has(property)))
      .toEqual([])
    expect(screen.getByRole('button', { name: 'Run review' })).toBeInstanceOf(HTMLButtonElement)
    expect(screen.getByRole('button', { name: 'Refresh tasks' })).toBeInstanceOf(HTMLButtonElement)
    expect(screen.getByRole('textbox', { name: 'Repository name' })).toBeInstanceOf(HTMLInputElement)
    expect(screen.getByRole('textbox', { name: 'Review note' })).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.getByRole('checkbox', { name: 'Include generated files' })).toHaveProperty('checked', true)
    expect(screen.getByRole('switch', { name: 'Enable notifications' })).toHaveProperty('checked', true)
    expect(screen.getByRole('status').textContent).toBe('Ready')
    expect(screen.getByRole('region', { name: 'Review summary' }).textContent).toContain('Two files changed.')
  })
})
