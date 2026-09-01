import { render, screen, fireEvent, within } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerView'
import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
import IconRail from './IconRail.svelte'
import type { AppView } from '../../lib/types'
import { commandHeld } from '../../lib/stores'

describe('IconRail', () => {
  it('renders 2 static navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
  })

  it('exposes accessible names and current page state for static navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Project Settings' }).hasAttribute('aria-current')).toBe(false)
  })

  it('projects the selected provider title and icon onto the stable dashboard entry', () => {
    commandHeld.set(true)
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate: vi.fn(),
        dashboardNavItem: { title: 'Planning', icon: 'panels-top-left' },
        activeProjectAttentionCount: 2,
      },
    })

    const dashboard = screen.getByRole('button', { name: 'Planning' })
    expect(dashboard.getAttribute('aria-current')).toBe('page')
    expect(within(dashboard).getByText('2')).toBeTruthy()
    expect(screen.getByText('H')).toBeTruthy()
    commandHeld.set(false)
  })

  it('clicking Board calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate } })
    fireEvent.click(screen.getByRole('button', { name: /board/i }))
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking Project Settings calls onNavigate with "settings"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate } })
    fireEvent.click(screen.getByRole('button', { name: /project settings/i }))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('marks Board and Project Settings current states semantically', () => {
    const { unmount } = render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })
    expect(screen.getByRole('button', { name: /board/i }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: /project settings/i }).getAttribute('aria-current')).toBeNull()
    unmount()

    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate: vi.fn() } })
    expect(screen.getByRole('button', { name: /board/i }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: /project settings/i }).getAttribute('aria-current')).toBe('page')
  })

  it('renders plugin navigation items before Settings', () => {
    const onNavigate = vi.fn()
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate,
        pluginNavItems: [
          {
            viewKey: FILE_VIEWER_VIEW_KEY,
            icon: 'folder-open',
            title: 'Files',
            shortcut: '⌘O',
          },
        ],
      },
    })

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)

    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith(FILE_VIEWER_VIEW_KEY)

    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('renders a custom SVG plugin icon as decorative content inside the accessible navigation button', () => {
    render(IconRail, {
      props: {
        currentView: 'board' as AppView,
        onNavigate: vi.fn(),
        pluginNavItems: [
          {
            viewKey: 'plugin:acme.issues:issues',
            icon: {
              type: 'svg',
              svg: '<svg viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"></path></svg>',
            },
            title: 'Issues',
            shortcut: null,
          },
        ],
      },
    })

    const button = screen.getByRole('button', { name: 'Issues' })
    expect(button.querySelector('path')?.getAttribute('d')).toBe('M12 2 22 12 12 22 2 12Z')
    expect(button.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  describe('active-repo PR count badge', () => {
    const prRailItem = {
      viewKey: GITHUB_SYNC_VIEW_KEY,
      icon: 'git-pull-request',
      title: 'Pull Requests',
      shortcut: '⌘G',
    }

    it('renders the active-repo unopened review count on the per-repo PR rail item', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [prRailItem],
          activeRepoReviewRequestCount: 3,
        },
      })
      expect(screen.getByText('3')).toBeTruthy()
    })

    it('omits the review badge when the active-repo count is zero', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [prRailItem],
          activeRepoReviewRequestCount: 0,
        },
      })
      expect(screen.queryByText('0')).toBeNull()
    })

    it('does not place the PR count badge on the static (non-PR) rail items', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [],
          activeRepoReviewRequestCount: 3,
        },
      })
      // Only Board + Project Settings render; neither is the PR view, so no badge appears.
      expect(screen.queryByText('3')).toBeNull()
    })
  })

  describe('board attention count badge (green dot)', () => {
    const prRailItem = {
      viewKey: GITHUB_SYNC_VIEW_KEY,
      icon: 'git-pull-request',
      title: 'Pull Requests',
      shortcut: '⌘G',
    }

    it('renders the active-project Focus attention count on the Board rail item', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          activeProjectAttentionCount: 3,
        },
      })
      const boardButton = screen.getByRole('button', { name: 'Board' })
      expect(within(boardButton).getByText('3')).toBeTruthy()
    })

    it('omits the attention badge when the active-project count is zero', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          activeProjectAttentionCount: 0,
        },
      })
      expect(screen.queryByText('0')).toBeNull()
    })

    it('places the attention count only on the Board item, not Project Settings or the PR item', () => {
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [prRailItem],
          activeProjectAttentionCount: 5,
          activeRepoReviewRequestCount: 0,
        },
      })
      const boardButton = screen.getByRole('button', { name: 'Board' })
      const settingsButton = screen.getByRole('button', { name: 'Project Settings' })
      const prButton = screen.getByRole('button', { name: 'Pull Requests' })
      expect(within(boardButton).getByText('5')).toBeTruthy()
      expect(within(settingsButton).queryByText('5')).toBeNull()
      expect(within(prButton).queryByText('5')).toBeNull()
    })
  })

  describe('shortcut badges', () => {
    it('shows shortcut key badges only for nav items with registered shortcuts when commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()
      expect(screen.queryByText(',')).toBeNull()

      commandHeld.set(false)
    })

    it('hides shortcut badges when commandHeld is false', () => {
      commandHeld.set(false)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText(',')).toBeNull()
    })

    it('does not advertise Cmd+, on Project Settings because Cmd+, opens Global Settings', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn() } })

      expect(screen.getByText('H')).toBeTruthy()
      expect(screen.queryByText(',')).toBeNull()

      commandHeld.set(false)
    })

    it('hides kbd badges when modalsOpen is true even if commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), modalsOpen: true } })

      expect(screen.queryByText('H')).toBeNull()
      expect(screen.queryByText(',')).toBeNull()

      commandHeld.set(false)
    })

    it('shows plugin shortcut badges when commandHeld is true', () => {
      commandHeld.set(true)
      render(IconRail, {
        props: {
          currentView: 'board' as AppView,
          onNavigate: vi.fn(),
          pluginNavItems: [
            {
              viewKey: FILE_VIEWER_VIEW_KEY,
              icon: 'folder-open',
              title: 'Files',
              shortcut: '⌘O',
            },
          ],
        },
      })

      expect(screen.getByText('O')).toBeTruthy()
      commandHeld.set(false)
    })
  })

})
