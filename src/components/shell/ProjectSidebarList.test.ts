import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setConfig } from '../../lib/ipc'
import { activeProjectId, attentionCountByProject, hiddenProjectIds, projects, reviewRequestCountByProject } from '../../lib/stores'
import type { Project } from '../../lib/types'
import ProjectSidebarList from './ProjectSidebarList.svelte'

const reviewCounts = reviewRequestCountByProject as unknown as Writable<Map<string, number>>
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
}))

vi.mock('@lucide/svelte', () => {
  const stub = vi.fn()
  return {
    ArrowDown: stub,
    ArrowUp: stub,
    Bot: stub,
    ChevronDown: stub,
    ChevronRight: stub,
    Eye: stub,
    EyeOff: stub,
    GitPullRequest: stub,
    Plus: stub,
  }
})

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Alpha Project', path: '/users/alice/alpha', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Beta Project', path: '/users/bob/beta', created_at: 0, updated_at: 0 },
  { id: 'proj-3', name: 'Gamma Project', path: '/users/charlie/gamma', created_at: 0, updated_at: 0 },
]

function renderProjectList(props?: Partial<{
  collapsed: boolean
  projectContextActive: boolean
  onNewProject?: () => void
  onSelectProject: (projectId: string) => void
}>) {
  return render(ProjectSidebarList, {
    props: {
      collapsed: false,
      projectContextActive: true,
      onNewProject: vi.fn(),
      onSelectProject: vi.fn(),
      ...props,
    },
  })
}

describe('ProjectSidebarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projects.set(sampleProjects)
    hiddenProjectIds.set(new Set())
    activeProjectId.set('proj-1')
    attentionCounts.set(new Map())
    reviewCounts.set(new Map())
  })

  it('shows the project heading only when expanded', () => {
    const { unmount } = renderProjectList({ collapsed: false })
    expect(screen.getByText('PROJECTS')).toBeTruthy()
    unmount()

    renderProjectList({ collapsed: true })
    expect(screen.queryByText('PROJECTS')).toBeNull()
  })

  it('shows project names when expanded', () => {
    renderProjectList()

    expect(screen.getByText('Alpha Project')).toBeTruthy()
    expect(screen.getByText('Beta Project')).toBeTruthy()
  })

  it('shows first-letter avatars when collapsed', () => {
    renderProjectList({ collapsed: true })

    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('delegates project selection', async () => {
    const onSelectProject = vi.fn()
    renderProjectList({ onSelectProject })

    await fireEvent.click(screen.getByRole('button', { name: /^beta project$/i }))

    expect(onSelectProject).toHaveBeenCalledWith('proj-2')
  })

  it('delegates project creation', async () => {
    const onNewProject = vi.fn()
    renderProjectList({ onNewProject })

    await fireEvent.click(screen.getByRole('button', { name: /add project/i }))

    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('marks the active project current only in a project context', () => {
    const { unmount } = renderProjectList({ projectContextActive: true })
    expect(screen.getByRole('button', { name: /^alpha project$/i }).getAttribute('aria-current')).toBe('true')
    unmount()

    renderProjectList({ projectContextActive: false })
    expect(screen.getByRole('button', { name: /^alpha project$/i }).getAttribute('aria-current')).toBeNull()
  })

  describe('badges', () => {
    it('shows attention counts and omits zero counts', () => {
      attentionCounts.set(new Map([
        ['proj-1', 0],
        ['proj-2', 3],
      ]))

      renderProjectList()

      expect(screen.getByTitle(/3 items needing attention/i).textContent).toContain('3')
      expect(screen.getAllByTitle(/item.* needing attention/i)).toHaveLength(1)
    })

    it('does not show an attention indicator when no project needs attention', () => {
      renderProjectList()
      expect(screen.queryByTitle(/needing attention/i)).toBeNull()
    })

    it('shows a pending review count when expanded', () => {
      reviewCounts.set(new Map([['proj-1', 2]]))
      renderProjectList()

      expect(screen.getByTitle(/2 PRs awaiting your review/i).textContent).toContain('2')
    })

    it('shows a review dot without its number when collapsed', () => {
      reviewCounts.set(new Map([['proj-2', 1]]))
      renderProjectList({ collapsed: true })

      expect(screen.getByTitle(/1 PR awaiting your review/i).textContent).toBe('')
    })

    it('does not show a review badge for a zero count', () => {
      reviewCounts.set(new Map([['proj-1', 0]]))
      renderProjectList()

      expect(screen.queryByTitle(/awaiting your review/i)).toBeNull()
    })
  })

  describe('project reordering', () => {
    it('shows move controls only when expanded', () => {
      const { unmount } = renderProjectList({ collapsed: true })
      expect(screen.queryByLabelText(/Move Alpha Project down/i)).toBeNull()
      unmount()

      renderProjectList()
      expect(screen.queryByLabelText(/Move Alpha Project up/i)).toBeNull()
      expect(screen.getByLabelText(/Move Alpha Project down/i)).toBeTruthy()
      expect(screen.getByLabelText(/Move Beta Project up/i)).toBeTruthy()
      expect(screen.getByLabelText(/Move Beta Project down/i)).toBeTruthy()
      expect(screen.getByLabelText(/Move Gamma Project up/i)).toBeTruthy()
      expect(screen.queryByLabelText(/Move Gamma Project down/i)).toBeNull()
    })

    it('moves a project down and persists the new order', async () => {
      renderProjectList()
      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-2', 'proj-1', 'proj-3'])
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-2', 'proj-1', 'proj-3']))
    })

    it('moves a project up and persists the new order', async () => {
      renderProjectList()
      await fireEvent.click(screen.getByLabelText(/Move Gamma Project up/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-1', 'proj-3', 'proj-2'])
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-1', 'proj-3', 'proj-2']))
    })

    it('reverts the optimistic order if persistence fails', async () => {
      vi.mocked(setConfig).mockRejectedValueOnce(new Error('save failed'))
      renderProjectList()

      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-1', 'proj-2', 'proj-3'])
    })

    it('blocks another reorder while persistence is in progress', async () => {
      let resolveSave!: () => void
      vi.mocked(setConfig).mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSave = resolve
      }))
      renderProjectList()

      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      const alphaMoveUpButton = screen.getByLabelText(/Move Alpha Project up/i)
      expect(alphaMoveUpButton.hasAttribute('disabled')).toBe(true)
      await fireEvent.click(alphaMoveUpButton)
      expect(get(projects).map((project) => project.id)).toEqual(['proj-2', 'proj-1', 'proj-3'])
      expect(setConfig).toHaveBeenCalledTimes(1)

      resolveSave()
      await Promise.resolve()
    })

    it('reorders visible neighbours while preserving hidden slots', async () => {
      hiddenProjectIds.set(new Set(['proj-2']))
      renderProjectList()

      await fireEvent.click(screen.getByLabelText(/Move Alpha Project down/i))

      expect(get(projects).map((project) => project.id)).toEqual(['proj-3', 'proj-2', 'proj-1'])
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_order', JSON.stringify(['proj-3', 'proj-2', 'proj-1']))
    })
  })

  describe('project visibility', () => {
    it('shows hide controls only when expanded', () => {
      const { unmount } = renderProjectList()
      expect(screen.getByLabelText(/Hide Alpha Project/i)).toBeTruthy()
      expect(screen.getByLabelText(/Hide Beta Project/i)).toBeTruthy()
      unmount()

      renderProjectList({ collapsed: true })
      expect(screen.queryByLabelText(/Hide Alpha Project/i)).toBeNull()
    })

    it('hides a project optimistically and persists the hidden ids', async () => {
      renderProjectList()
      await fireEvent.click(screen.getByLabelText(/Hide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set(['proj-2']))
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_hidden', JSON.stringify(['proj-2']))
      expect(screen.queryByRole('button', { name: /^beta project$/i })).toBeNull()
    })

    it('reverts an optimistic hide if persistence fails', async () => {
      vi.mocked(setConfig).mockRejectedValueOnce(new Error('save failed'))
      renderProjectList()

      await fireEvent.click(screen.getByLabelText(/Hide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set())
    })

    it('shows a collapsed hidden section with its project count', () => {
      hiddenProjectIds.set(new Set(['proj-2', 'proj-3']))
      renderProjectList()

      expect(screen.getByText(/Hidden \(2\)/i)).toBeTruthy()
      expect(screen.queryByLabelText(/Unhide Beta Project/i)).toBeNull()
    })

    it('omits the hidden section when no projects are hidden or the sidebar is collapsed', () => {
      const { unmount } = renderProjectList()
      expect(screen.queryByText(/Hidden \(/i)).toBeNull()
      unmount()

      hiddenProjectIds.set(new Set(['proj-2']))
      renderProjectList({ collapsed: true })
      expect(screen.queryByText(/Hidden \(/i)).toBeNull()
    })

    it('expands hidden projects and unhides one', async () => {
      hiddenProjectIds.set(new Set(['proj-2']))
      renderProjectList()

      await fireEvent.click(screen.getByText(/Hidden \(1\)/i))
      await fireEvent.click(screen.getByLabelText(/Unhide Beta Project/i))

      expect(get(hiddenProjectIds)).toEqual(new Set())
      expect(setConfig).toHaveBeenCalledWith('project_sidebar_hidden', JSON.stringify([]))
    })
  })
})
