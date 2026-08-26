import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
import { setConfig } from '../../lib/ipc'
import { activeProjectId, attentionCountByProject, hiddenProjectIds, projects, reviewRequestCountByProject } from '../../lib/stores'
import type { AppView, Project } from '../../lib/types'
import type { IconRailPluginNavItem, SidebarPluginNavItem } from '../../lib/iconRailNav'
import AppSidebar from './AppSidebar.svelte'
import CustomPluginSidebarNavigation from './test-fixtures/CustomPluginSidebarNavigation.svelte'

// Production counts are derived; this suite mocks stores with writables to drive badges directly.
const reviewCountByProject = reviewRequestCountByProject as unknown as Writable<Map<string, number>>
const attentionCounts = attentionCountByProject as unknown as Writable<Map<string, number>>

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return {
    projects: writable<Project[]>([]),
    hiddenProjectIds: writable<Set<string>>(new Set()),
    activeProjectId: writable<string | null>(null),
    attentionCountByProject: writable<Map<string, number>>(new Map()),
    reviewRequestCountByProject: writable<Map<string, number>>(new Map()),
  }
})

vi.mock('../../lib/ipc', () => ({
  setConfig: vi.fn(async () => {}),
  getConfig: vi.fn(async () => null),
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
    Bot: stub,
    Boxes: stub,
    ChevronLeft: stub,
    ChevronRight: stub,
    ChevronDown: stub,
    ChartColumnBig: stub,
    Clock: stub,
    Code: stub,
    FileText: stub,
    FolderOpen: stub,
    GitPullRequest: stub,
    Kanban: stub,
    LayoutDashboard: stub,
    Plug: stub,
    Puzzle: stub,
    Settings: stub,
    Sparkles: stub,
    Terminal: stub,
    Wrench: stub,
    Plus: stub,
    ArrowUp: stub,
    ArrowDown: stub,
    EyeOff: stub,
    Eye: stub,
    LocateFixed: stub,
  }
})

const GLOBAL_PR_VIEW_KEY = 'plugin:com.openforge.github-sync:pr_review_global'

const globalPrNavItem: IconRailPluginNavItem = {
  viewKey: GLOBAL_PR_VIEW_KEY as AppView,
  icon: 'boxes',
  title: 'All Pull Requests',
  shortcut: null,
}

const customNavItem: SidebarPluginNavItem = {
  ...globalPrNavItem,
  navigation: {
    component: CustomPluginSidebarNavigation,
    props: {
      api: {} as never,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'proj-1' },
      view: {
        pluginId: 'com.openforge.github-sync',
        id: 'pr_review_global',
        qualifiedId: 'com.openforge.github-sync:pr_review_global',
        title: 'All Pull Requests',
        icon: 'boxes',
      },
    },
  },
}

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Project', path: '/users/charlie/gamma', created_at: 0, updated_at: 0 },
]

// The sidebar now delegates project selection to an onSelectProject callback (App owns
// the switch + last-viewed restore). Mirror the real switchToProject side effect —
// setting the active project — so selection assertions still hold.
const mockSelectProject = vi.fn((projectId: string) => {
  activeProjectId.set(projectId)
})

function renderSidebar(props?: Partial<{ collapsed: boolean; currentView: AppView; onToggleCollapse: () => void; onNewProject?: () => void; onNavigate: (view: AppView) => void; onSelectProject: (projectId: string) => void; onOpenAttentionOverview: () => void; pluginNavItems: SidebarPluginNavItem[]; reviewRequestCount: number }>) {
  const defaultProps = {
    collapsed: false,
    currentView: 'board' as AppView,
    onToggleCollapse: vi.fn(),
    onNewProject: vi.fn(),
    onNavigate: vi.fn(),
    onSelectProject: mockSelectProject,
    onOpenAttentionOverview: vi.fn(),
  }

  return render(AppSidebar, { props: { ...defaultProps, ...props } })
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projects.set(sampleProjects)
    hiddenProjectIds.set(new Set())
    activeProjectId.set('proj-1')
    attentionCounts.set(new Map())
    reviewCountByProject.set(new Map())
  })

  it('does not render the decorative >_ logo', () => {
    renderSidebar()
    expect(screen.queryByText('>_')).toBeNull()
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

  it('clicking a project button selects that project', async () => {
    renderSidebar({ collapsed: false })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(mockSelectProject).toHaveBeenCalledWith('proj-2')
    expect(get(activeProjectId)).toBe('proj-2')
  })

  it('clicking a project delegates the switch to onSelectProject regardless of the current view', async () => {
    // Landing on the right view (board vs. the project's last-viewed tab) is App's
    // responsibility via switchToProject; the sidebar only reports the selection.
    const onSelectProject = vi.fn()
    renderSidebar({ currentView: 'global_settings', onSelectProject })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))
    expect(onSelectProject).toHaveBeenCalledWith('proj-2')
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

  it('renders an Attention nav button so mouse-only users can open the dialog', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /attention/i })).toBeTruthy()
  })

  it('exposes the Attention button when collapsed via its accessible label', () => {
    renderSidebar({ collapsed: true })
    expect(screen.getByRole('button', { name: /attention/i })).toBeTruthy()
  })

  it('clicking Attention calls onOpenAttentionOverview', async () => {
    const onOpenAttentionOverview = vi.fn()
    renderSidebar({ onOpenAttentionOverview })

    await fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    expect(onOpenAttentionOverview).toHaveBeenCalledOnce()
  })

  it('does not mark Attention as a current view since it opens a dialog rather than navigating', () => {
    renderSidebar({ currentView: 'global_settings' })
    expect(screen.getByRole('button', { name: /attention/i }).getAttribute('aria-current')).toBeNull()
  })

  it('places Attention above the projects section header and the project list', () => {
    renderSidebar({ collapsed: false })

    const attention = screen.getByRole('button', { name: /attention/i })
    const projectsHeader = screen.getByText('PROJECTS')
    const firstProject = screen.getByRole('button', { name: /^alpha project$/i })

    expect(attention.compareDocumentPosition(projectsHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(attention.compareDocumentPosition(firstProject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps Attention above the projects when collapsed', () => {
    renderSidebar({ collapsed: true })

    const attention = screen.getByRole('button', { name: /attention/i })
    const addProject = screen.getByRole('button', { name: /add project/i })
    // Collapsed rows are avatar-only, so they identify themselves by title rather than label.
    const firstProject = screen.getByTitle('Alpha Project')

    expect(attention.compareDocumentPosition(addProject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(attention.compareDocumentPosition(firstProject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    attentionCounts.set(new Map([
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
    attentionCounts.set(new Map())
    renderSidebar({ collapsed: false })

    expect(screen.queryByTitle(/needing attention/i)).toBeNull()
  })
  it('project is NOT visually active (aria-current) when on global_settings view', () => {
    renderSidebar({ currentView: 'global_settings' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBeNull()
  })

  it('project IS visually active (aria-current) when on project settings view', () => {
    renderSidebar({ currentView: 'settings' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })

  it('project IS visually active (aria-current) when on board view', () => {
    renderSidebar({ currentView: 'board' })

    const activeProjectButton = screen.getByRole('button', { name: /^alpha project$/i })
    expect(activeProjectButton.getAttribute('aria-current')).toBe('true')
  })

  it('project IS visually active on a per-project (rail) plugin view like PR review', () => {
    // The per-project PR review view is scoped to the active project, so its project
    // stays highlighted — e.g. after opening a review request from the attention dialog.
    renderSidebar({ currentView: GITHUB_SYNC_VIEW_KEY })

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

    it('renders a custom SVG icon inside the sidebar plugin navigation button', () => {
      renderSidebar({
        pluginNavItems: [{
          ...globalPrNavItem,
          icon: {
            type: 'svg',
            svg: '<svg viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"></path></svg>',
          },
        }],
      })

      const button = screen.getByRole('button', { name: /all pull requests/i })
      expect(button.querySelector('path')?.getAttribute('d')).toBe('M12 2 22 12 12 22 2 12Z')
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

    it('renders custom sidebar navigation with host state, context, and activation behavior', async () => {
      const onNavigate = vi.fn()
      renderSidebar({
        pluginNavItems: [customNavItem],
        currentView: GLOBAL_PR_VIEW_KEY as AppView,
        collapsed: true,
        onNavigate,
      })

      const customNavigation = await screen.findByRole('button', { name: 'Custom All Pull Requests' })
      expect(customNavigation.getAttribute('aria-current')).toBe('page')
      expect(customNavigation.getAttribute('data-collapsed')).toBe('true')
      expect(customNavigation.getAttribute('data-project-id')).toBe('proj-1')

      await fireEvent.click(customNavigation)
      expect(onNavigate).toHaveBeenCalledWith(GLOBAL_PR_VIEW_KEY)
    })

    it('falls back to static navigation when a custom component fails to load', async () => {
      const failingItem: SidebarPluginNavItem = {
        ...customNavItem,
        navigation: {
          ...customNavItem.navigation!,
          component: async () => { throw new Error('broken navigation') },
        },
      }

      renderSidebar({ pluginNavItems: [failingItem] })

      expect(await screen.findByRole('button', { name: /all pull requests/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /global settings/i })).toBeTruthy()
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

  describe('Hiding projects', () => {
    it('shows a hide control for each visible project when expanded', () => {
      renderSidebar({ collapsed: false })
      expect(screen.getByLabelText(/Hide Alpha Project/i)).toBeTruthy()
      expect(screen.getByLabelText(/Hide Beta Project/i)).toBeTruthy()
    })

    it('does not show hide controls when collapsed', () => {
      renderSidebar({ collapsed: true })
      expect(screen.queryByLabelText(/Hide Alpha Project/i)).toBeNull()
    })

    it('hiding a project persists it and removes it from the visible list', async () => {
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Hide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set(['proj-2']))
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_hidden', JSON.stringify(['proj-2']))
      // Beta's own row button is gone from the visible list; the collapsed Hidden section hides it.
      expect(screen.queryByRole('button', { name: /^beta project$/i })).toBeNull()
    })

    it('reverts the optimistic hide if persisting fails', async () => {
      vi.mocked(setConfig).mockRejectedValueOnce(new Error('save failed'))
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Hide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set())
    })

    it('renders a silent Hidden section with the hidden count', () => {
      hiddenProjectIds.set(new Set(['proj-2', 'proj-3']))
      renderSidebar({ collapsed: false })
      expect(screen.getByText(/Hidden \(2\)/i)).toBeTruthy()
    })

    it('does not render the Hidden section when nothing is hidden', () => {
      renderSidebar({ collapsed: false })
      expect(screen.queryByText(/Hidden \(/i)).toBeNull()
    })

    it('does not render the Hidden section when collapsed', () => {
      hiddenProjectIds.set(new Set(['proj-2']))
      renderSidebar({ collapsed: true })
      expect(screen.queryByText(/Hidden \(/i)).toBeNull()
    })

    it('expanding the Hidden section reveals hidden projects with an unhide control', async () => {
      hiddenProjectIds.set(new Set(['proj-2']))
      renderSidebar({ collapsed: false })
      // Collapsed by default — the hidden project's unhide control is not yet shown.
      expect(screen.queryByLabelText(/Unhide Beta Project/i)).toBeNull()

      await fireEvent.click(screen.getByText(/Hidden \(1\)/i))
      expect(screen.getByLabelText(/Unhide Beta Project/i)).toBeTruthy()
    })

    it('unhiding a project persists its removal from the hidden set', async () => {
      hiddenProjectIds.set(new Set(['proj-2']))
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByText(/Hidden \(1\)/i))
      await fireEvent.click(screen.getByLabelText(/Unhide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set())
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_hidden', JSON.stringify([]))
    })

    it('reordering targets the correct visible neighbour when a project is hidden', async () => {
      // Hide Beta (proj-2), which sits between Alpha and Gamma. Moving Alpha down must
      // swap it with Gamma (the next VISIBLE project), leaving Beta in its slot.
      hiddenProjectIds.set(new Set(['proj-2']))
      renderSidebar({ collapsed: false })
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((p) => p.id)).toEqual(['proj-3', 'proj-2', 'proj-1'])
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-3', 'proj-2', 'proj-1']))
    })
  })
})
