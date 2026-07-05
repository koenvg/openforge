import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setConfig } from '../../lib/ipc'
import { activeProjectId, attentionCountByProject, projects, reviewRequestCountByProject } from '../../lib/stores'
import type { AppView, Project } from '../../lib/types'
import AppSidebar from './AppSidebar.svelte'

// In production reviewRequestCountByProject is a `derived` (Readable) store, but this suite
// mocks '../../lib/stores' with a writable so tests can drive per-project counts directly.
const reviewCountByProject = reviewRequestCountByProject as unknown as Writable<Map<string, number>>

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return {
    projects: writable<Project[]>([]),
    activeProjectId: writable<string | null>(null),
    attentionCountByProject: writable<Map<string, number>>(new Map()),
    reviewRequestCountByProject: writable<Map<string, number>>(new Map()),
  }
})

vi.mock('../../lib/ipc', () => ({
  setConfig: vi.fn(async () => {}),
  getGitBranch: vi.fn(async () => 'main'),
}))

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

vi.mock('@lucide/svelte', () => {
  const stub = vi.fn()
  return {
    ChevronLeft: stub,
    ChevronRight: stub,
    Settings: stub,
    Plus: stub,
    ArrowUp: stub,
    ArrowDown: stub,
  }
})

vi.mock('../../lib/iconRailIcons', () => ({
  resolveIconRailIcon: () => vi.fn(),
}))

const GLOBAL_PR_VIEW_KEY = 'plugin:com.openforge.github-sync:pr_review_global'

const globalPrNavItem = {
  viewKey: GLOBAL_PR_VIEW_KEY as AppView,
  icon: 'boxes',
  title: 'All Pull Requests',
  shortcut: null,
}

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Project', path: '/users/charlie/gamma', created_at: 0, updated_at: 0 },
]

function renderSidebar(props?: Partial<{ collapsed: boolean; currentView: AppView; onToggleCollapse: () => void; onNewProject?: () => void; onNavigate: (view: AppView) => void; pluginNavItems: typeof globalPrNavItem[]; reviewRequestCount: number }>) {
  const defaultProps = {
    collapsed: false,
    currentView: 'board' as AppView,
    onToggleCollapse: vi.fn(),
    onNewProject: vi.fn(),
    onNavigate: vi.fn(),
  }

  return render(AppSidebar, { props: { ...defaultProps, ...props } })
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projects.set(sampleProjects)
    activeProjectId.set('proj-1')
    attentionCountByProject.set(new Map())
    reviewCountByProject.set(new Map())
  })

  it('renders the >_ logo', () => {
    renderSidebar()
    expect(screen.getByText('>_')).toBeTruthy()
  })

  it('shows "PROJECTS" label when expanded (collapsed=false)', () => {
    renderSidebar({ collapsed: false })
    expect(screen.getByText('PROJECTS')).toBeTruthy()
  })

  it('does NOT show "PROJECTS" label when collapsed (collapsed=true)', () => {
    renderSidebar({ collapsed: true })
    expect(screen.queryByText('PROJECTS')).toBeNull()
  })

  it('renders project buttons for each project in the store', () => {
    renderSidebar({ collapsed: false })

    expect(screen.getByRole('button', { name: /^alpha project$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^beta project$/i })).toBeTruthy()
  })

  it('shows first-letter avatars when collapsed', () => {
    renderSidebar({ collapsed: true })

    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('shows project names when expanded', () => {
    renderSidebar({ collapsed: false })

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Beta Project')).toBeTruthy()
  })

  it('clicking a project button sets activeProjectId', async () => {
    renderSidebar({ collapsed: false })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(get(activeProjectId)).toBe('proj-2')
  })

  it('clicking a project while on global_settings resets to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
    vi.mocked(resetToBoard).mockClear()
    renderSidebar({ currentView: 'global_settings' })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(resetToBoard).toHaveBeenCalled()
  })

  it('does not render Work Queue nav button', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: /work queue/i })).toBeNull()
  })

  it('renders Global Settings nav button with a clear label', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /global settings/i })).toBeTruthy()
  })

  it('marks Global Settings as current only on the global settings view', () => {
    const { unmount } = renderSidebar({ currentView: 'global_settings' })
    expect(screen.getByRole('button', { name: /global settings/i }).getAttribute('aria-current')).toBe('page')
    unmount()

    renderSidebar({ currentView: 'settings' })
    expect(screen.getByRole('button', { name: /global settings/i }).getAttribute('aria-current')).toBeNull()
  })

  it('clicking Global Settings calls onNavigate(\'global_settings\')', async () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    await fireEvent.click(screen.getByRole('button', { name: /global settings/i }))
    expect(onNavigate).toHaveBeenCalledWith('global_settings')
  })

  it('clicking collapse toggle calls onToggleCollapse', async () => {
    const onToggleCollapse = vi.fn()
    renderSidebar({ collapsed: false, onToggleCollapse })

    await fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('calls onNewProject when add project button is clicked', async () => {
    const onNewProject = vi.fn()
    renderSidebar({ onNewProject })

    await fireEvent.click(screen.getByRole('button', { name: /add project/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('shows each project\'s attention count from the store and hides it at zero', () => {
    attentionCountByProject.set(new Map([
      // A project whose only tasks are in-flight resolves to 0 — no indicator. The
      // exclusion of running agents / Out of Focus tasks lives in the count itself (attentionCounts.ts).
      ['proj-1', 0],
      ['proj-2', 3],
    ]))

    renderSidebar({ collapsed: false })

    expect(screen.getByTitle(/3 items needing attention/i).textContent).toContain('3')
    // The zero-count project contributes no attention indicator.
    expect(screen.getAllByTitle(/item.* needing attention/i)).toHaveLength(1)
    // The old status labels are gone entirely.
    expect(screen.queryByText('2 running')).toBeNull()
    expect(screen.queryByText('idle')).toBeNull()
  })


  it('does not render an attention indicator when nothing needs attention', () => {
    attentionCountByProject.set(new Map())
    renderSidebar({ collapsed: false })

    expect(screen.queryByTitle(/needing attention/i)).toBeNull()
  })
  it('project is NOT visually active (aria-current) when on global_settings view', () => {
    renderSidebar({ currentView: 'global_settings' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project is NOT visually active (aria-current) when on project settings view', () => {
    renderSidebar({ currentView: 'settings' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project IS visually active (aria-current) when on board view', () => {
    renderSidebar({ currentView: 'board' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })

  it('project IS visually active on a per-project (rail) plugin view like PR review', () => {
    // The per-project PR review view is scoped to the active project, so its project
    // stays highlighted — e.g. after opening a review request from the attention dialog.
    renderSidebar({ currentView: 'plugin:com.openforge.github-sync:pr_review' as AppView })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })

  it('project is NOT visually active on the global (sidebar) All Pull Requests view', () => {
    // The all-repos view is cross-project, so no single project row should be highlighted.
    renderSidebar({ pluginNavItems: [globalPrNavItem], currentView: GLOBAL_PR_VIEW_KEY as AppView })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  describe('sidebar plugin nav items', () => {
    it('renders a sidebar plugin nav item with its title', () => {
      renderSidebar({ pluginNavItems: [globalPrNavItem] })
      expect(screen.getByRole('button', { name: /all pull requests/i })).toBeTruthy()
    })

    it('clicking a sidebar plugin nav item navigates to its view key', async () => {
      const onNavigate = vi.fn()
      renderSidebar({ pluginNavItems: [globalPrNavItem], onNavigate })

      await fireEvent.click(screen.getByRole('button', { name: /all pull requests/i }))
      expect(onNavigate).toHaveBeenCalledWith(GLOBAL_PR_VIEW_KEY)
    })

    it('marks the sidebar plugin nav item current when its view is active', () => {
      renderSidebar({ pluginNavItems: [globalPrNavItem], currentView: GLOBAL_PR_VIEW_KEY as AppView })
      expect(screen.getByRole('button', { name: /all pull requests/i }).getAttribute('aria-current')).toBe('page')
    })

    it('shows the review request count badge on the all-repos item', () => {
      renderSidebar({ pluginNavItems: [globalPrNavItem], reviewRequestCount: 3 })
      expect(screen.getByText('3')).toBeTruthy()
    })

    it('does not show the review count badge when the count is zero', () => {
      renderSidebar({ pluginNavItems: [globalPrNavItem], reviewRequestCount: 0 })
      expect(screen.queryByText('0')).toBeNull()
    })

    it('renders no extra nav buttons when there are no sidebar plugin items', () => {
      renderSidebar({ pluginNavItems: [] })
      expect(screen.queryByRole('button', { name: /all pull requests/i })).toBeNull()
    })
  })

  describe('per-project review count badge', () => {
    it('shows a project\'s pending review count when expanded', () => {
      reviewCountByProject.set(new Map([['proj-1', 2]]))
      renderSidebar({ collapsed: false })

      expect(screen.getByTitle(/2 PRs awaiting your review/i).textContent).toContain('2')
    })

    it('shows a red review dot without the number on the collapsed avatar', () => {
      reviewCountByProject.set(new Map([['proj-2', 1]]))
      renderSidebar({ collapsed: true })

      const dot = screen.getByTitle(/1 PR awaiting your review/i)
      expect(dot).toBeTruthy()
      // Collapsed shows only a dot — the count number itself is not rendered.
      expect(dot.textContent).toBe('')
    })

    it('renders no review badge for a project with zero pending reviews', () => {
      reviewCountByProject.set(new Map([['proj-1', 0]]))
      renderSidebar({ collapsed: false })

      expect(screen.queryByTitle(/awaiting your review/i)).toBeNull()
    })
  })

  describe('Project reordering', () => {
    it('does not show move buttons when collapsed', () => {
      renderSidebar({ collapsed: true })
      expect(screen.queryByLabelText(/Move Alpha Project up/i)).toBeNull()
      expect(screen.queryByLabelText(/Move Alpha Project down/i)).toBeNull()
    })

    it('shows move buttons when expanded', () => {
      renderSidebar({ collapsed: false })
      expect(screen.queryByLabelText(/Move Alpha Project up/i)).toBeNull()
      expect(screen.getByLabelText(/Move Alpha Project down/i)).toBeTruthy()
      
      expect(screen.getByLabelText(/Move Beta Project up/i)).toBeTruthy()
      expect(screen.getByLabelText(/Move Beta Project down/i)).toBeTruthy()
      
      expect(screen.getByLabelText(/Move Gamma Project up/i)).toBeTruthy()
      expect(screen.queryByLabelText(/Move Gamma Project down/i)).toBeNull()
    })

    it('moves a project down', async () => {
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))
      
      const currentProjects = get(projects)
      expect(currentProjects[0].id).toBe('proj-2')
      expect(currentProjects[1].id).toBe('proj-1')
      expect(currentProjects[2].id).toBe('proj-3')
      
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-2', 'proj-1', 'proj-3']))
    })

    it('moves a project up', async () => {
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Gamma Project up/i))
      
      const currentProjects = get(projects)
      expect(currentProjects[0].id).toBe('proj-1')
      expect(currentProjects[1].id).toBe('proj-3')
      expect(currentProjects[2].id).toBe('proj-2')

      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-1', 'proj-3', 'proj-2']))
    })

    it('reverts the optimistic order if persisting fails', async () => {
      vi.mocked(setConfig).mockRejectedValueOnce(new Error('save failed'))

      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-1', 'proj-2', 'proj-3'])
    })

    it('disables further reordering while a save is in progress', async () => {
      let resolveSave!: () => void
      vi.mocked(setConfig).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve
          })
      )

      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      const alphaMoveUpButton = screen.getByLabelText(/Move Alpha Project up/i)
      expect(alphaMoveUpButton.hasAttribute('disabled')).toBe(true)

      await fireEvent.click(alphaMoveUpButton)
      expect(get(projects).map((project) => project.id)).toEqual(['proj-2', 'proj-1', 'proj-3'])
      expect(setConfig).toHaveBeenCalledTimes(1)

      resolveSave()
    })
  })
})
