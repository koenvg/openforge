import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRoadmapView } from './RoadmapView.testUtils'
import type { RoadmapBoard, RoadmapConfig } from '../lib/types'

const board: RoadmapBoard = {
  repo: { owner: 'octo', name: 'cat' },
  issues: [],
  labels: [
    { name: 'alpha', color: 'ff0000' },
    { name: 'beta', color: '00ff00' },
    { name: 'gamma', color: '0000ff' },
  ],
  values: {},
  columnLabels: ['alpha', 'beta', 'gamma'],
}

const config: RoadmapConfig = {
  columnLabels: ['alpha', 'beta', 'gamma'],
  labels: [
    { name: 'alpha', color: 'ff0000', used: true },
    { name: 'beta', color: '00ff00', used: true },
    { name: 'gamma', color: '0000ff', used: true },
  ],
}

async function openColumnsAndReorder() {
  // Wait for the board to load (a board-only control appears) so the header
  // Columns button is enabled.
  await screen.findByRole('button', { name: 'Change color of alpha' })
  await fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
  // Modal is open; reorder alpha down -> beta, alpha, gamma.
  await fireEvent.click(await screen.findByRole('button', { name: 'Move alpha down' }))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('RoadmapView column save', () => {
  it('shows the loaded repository slug in the header subtitle', async () => {
    renderRoadmapView({
      roadmap_get_board: async () => board,
    })

    expect(await screen.findByText('octo/cat')).toBeTruthy()
    expect(screen.queryByText('undefined/undefined')).toBeNull()
  })

  it('reloads only when the logical project ID changes and hides the previous board while loading', async () => {
    const loadedProjectIds: string[] = []
    let releaseSecondProject!: () => void
    const secondProjectGate = new Promise<void>((resolve) => {
      releaseSecondProject = resolve
    })
    const { api, rerender } = renderRoadmapView({
      roadmap_get_board: async (payload) => {
        const { projectId } = payload as { projectId: string }
        loadedProjectIds.push(projectId)
        if (projectId === 'proj-2') await secondProjectGate
        return projectId === 'proj-2'
          ? { ...board, repo: { owner: 'octo', name: 'dog' } }
          : board
      },
    })

    expect(await screen.findByText('octo/cat')).toBeTruthy()
    await rerender({ api, projectId: 'proj-1', projectName: 'Renamed Cat' })
    expect(loadedProjectIds).toEqual(['proj-1'])

    await rerender({ api, projectId: 'proj-2', projectName: 'Dog' })
    await waitFor(() => expect(loadedProjectIds).toEqual(['proj-1', 'proj-2']))
    expect(screen.queryByText('octo/cat')).toBeNull()
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)

    releaseSecondProject()
    expect(await screen.findByText('octo/dog')).toBeTruthy()
    expect(loadedProjectIds).toEqual(['proj-1', 'proj-2'])
  })

  it('ignores a board response from an earlier activation after switching away and back', async () => {
    let firstProjectLoad = true
    let firstLoadCompleted = false
    let releaseFirstLoad!: () => void
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const { api, rerender } = renderRoadmapView({
      roadmap_get_board: async (payload) => {
        const { projectId } = payload as { projectId: string }
        if (projectId === 'proj-1' && firstProjectLoad) {
          firstProjectLoad = false
          await firstLoadGate
          firstLoadCompleted = true
          return { ...board, repo: { owner: 'octo', name: 'stale-cat' } }
        }
        return projectId === 'proj-2'
          ? { ...board, repo: { owner: 'octo', name: 'dog' } }
          : { ...board, repo: { owner: 'octo', name: 'current-cat' } }
      },
    })

    await waitFor(() => expect(firstProjectLoad).toBe(false))
    await rerender({ api, projectId: 'proj-2', projectName: 'Dog' })
    expect(await screen.findByText('octo/dog')).toBeTruthy()
    await rerender({ api, projectId: 'proj-1', projectName: 'Cat again' })
    expect(await screen.findByText('octo/current-cat')).toBeTruthy()

    releaseFirstLoad()
    await waitFor(() => expect(firstLoadCompleted).toBe(true))
    expect(screen.queryByText('octo/stale-cat')).toBeNull()
    expect(screen.getByText('octo/current-cat')).toBeTruthy()
  })

  it('saves the reordered labels and closes the dialog on success', async () => {
    const { invoke } = renderRoadmapView({
      roadmap_get_board: async () => board,
      roadmap_get_config: async () => config,
      roadmap_set_column_labels: async () => null,
    })

    await openColumnsAndReorder()
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('roadmap_set_column_labels', {
        projectId: 'proj-1',
        labels: ['beta', 'alpha', 'gamma'],
      }),
    )
    // Dialog closes on success.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull())
  })

  it('surfaces an error to the user when the save fails', async () => {
    renderRoadmapView({
      roadmap_get_board: async () => board,
      roadmap_get_config: async () => config,
      roadmap_set_column_labels: async () => {
        throw new Error('save columns boom')
      },
    })

    await openColumnsAndReorder()
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The failure must be visible somewhere, not silently swallowed.
    expect(await screen.findByText(/save columns boom/)).toBeTruthy()
    // ...and the dialog stays open so the user can retry.
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })
})

describe('RoadmapView issue creation', () => {
  it('keeps a newly created issue visible when a manual board reload has not caught up', async () => {
    let boardLoads = 0
    renderRoadmapView({
      roadmap_get_board: async () => {
        boardLoads += 1
        return board
      },
      roadmap_create_issue: async () => ({
        issue: {
          number: 99,
          title: 'Persist created ticket',
          body: '',
          state: 'open',
          html_url: 'https://github.com/octo/cat/issues/99',
          labels: [],
        },
      }),
    })

    await screen.findByRole('button', { name: 'Create issue with no label' })
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await fireEvent.input(screen.getByLabelText('Describe the issue'), {
      target: { value: 'Persist created ticket' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Skip AI' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

    await waitFor(() => {
      expect(screen.getByText('Persist created ticket')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(boardLoads).toBe(1)

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(boardLoads).toBe(2)
      expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false)
    })
    expect(screen.getByText('Persist created ticket')).toBeTruthy()
  })
})
