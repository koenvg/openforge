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
  requiresWorkspace: true,
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

  it('uses one shared animated highlight across core and plugin panes', () => {
    const { container } = render(TaskPaneNavigation, {
      props: {
        activeView: activityTab.namespacedId,
        tabs: [activityTab],
        commandHeld: false,
        onSelect: vi.fn(),
      },
    })

    expect(container.querySelectorAll('[data-animated-nav-indicator]')).toHaveLength(1)
    expect([...container.querySelectorAll('[data-animated-nav-item]')].map((item) => item.getAttribute('data-animated-nav-item')))
      .toEqual(['agent', 'review', activityTab.namespacedId])
  })

  it('marks the Agent tab visibly and accessibly while another pane is active', () => {
    render(TaskPaneNavigation, {
      props: {
        activeView: 'review',
        tabs: [],
        commandHeld: false,
        hasUnreadAgentOutput: true,
        onSelect: vi.fn(),
      },
    })

    const agentTab = screen.getByRole('button', { name: /agent.*unread agent output/i })
    expect(agentTab.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('agent-unread-marker')).toBeTruthy()
  })

  it('removes the Agent tab marker after output is viewed', () => {
    render(TaskPaneNavigation, {
      props: {
        activeView: 'review',
        tabs: [],
        commandHeld: false,
        hasUnreadAgentOutput: false,
        onSelect: vi.fn(),
      },
    })

    expect(screen.queryByText('Unread agent output')).toBeNull()
    expect(screen.queryByTestId('agent-unread-marker')).toBeNull()
    expect(screen.getByRole('button', { name: 'agent' })).toBeTruthy()
  })
})
