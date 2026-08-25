import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
import TaskPaneNavigation from './TaskPaneNavigation.svelte'

const activityTab: ResolvedTab = {
  pluginId: 'plugin.activity',
  contributionId: 'activity',
  namespacedId: 'plugin.activity:activity',
  title: 'Activity',
  icon: null,
  order: 5,
}

describe('TaskPaneNavigation', () => {
  it('reports core and plugin pane selections through one callback', async () => {
    const onSelect = vi.fn()
    render(TaskPaneNavigation, {
      props: {
        activeView: 'agent',
        tabs: [activityTab],
        commandHeld: false,
        onSelect,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'review' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Activity' }))

    expect(onSelect.mock.calls).toEqual([['review'], ['plugin.activity:activity']])
  })

  it('shows shortcuts in the same sorted tab order used by the controller', () => {
    render(TaskPaneNavigation, {
      props: {
        activeView: activityTab.namespacedId,
        tabs: [activityTab],
        commandHeld: true,
        onSelect: vi.fn(),
      },
    })

    expect(screen.getByRole('button', { name: /^agent/ }).textContent).toContain('⌘1')
    expect(screen.getByRole('button', { name: /^review/ }).textContent).toContain('⌘2')
    expect(screen.getByRole('button', { name: /^Activity/ }).textContent).toContain('⌘3')
    expect(screen.getByRole('button', { name: /^Activity/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
