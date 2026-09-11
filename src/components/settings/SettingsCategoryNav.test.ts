import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import SettingsCategoryNav from './SettingsCategoryNav.svelte'

describe('SettingsCategoryNav', () => {
  it('uses one shared highlight for the category rows', () => {
    render(SettingsCategoryNav, {
      props: {
        categories: [
          { id: 'general', label: 'General' },
          { id: 'agents', label: 'Agents' },
          { id: 'danger', label: 'Danger Zone', danger: true },
        ],
        activeId: 'general',
        onSelect: () => {},
      },
    })

    const nav = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(nav.querySelectorAll('[data-animated-nav-indicator]')).toHaveLength(1)
    expect(nav.querySelectorAll('[data-animated-nav-item]')).toHaveLength(3)
    expect(nav.querySelector('[data-animated-nav-rail]')).toBeNull()
  })
})
