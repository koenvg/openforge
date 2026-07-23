import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRoadmapView } from './RoadmapView.testUtils'
import type { RoadmapBoard, RoadmapIssue } from '../lib/types'

// A board whose issue list intentionally never contains the freshly created
// issue. This mirrors GitHub's eventually-consistent issue listing: a just-created
// issue is frequently absent from an immediately-following list call, so a refetch
// right after creation would drop the new card.
const staleBoard: RoadmapBoard = {
  repo: { owner: 'octo', name: 'cat' },
  issues: [],
  labels: [{ name: 'alpha', color: 'ff0000' }],
  values: {},
  columnLabels: ['alpha'],
}

const createdIssue: RoadmapIssue = {
  number: 42,
  title: 'Newly created ticket',
  body: '',
  state: 'open',
  html_url: 'https://github.com/octo/cat/issues/42',
  labels: [],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('RoadmapView issue creation', () => {
  it('keeps the newly created card visible without immediately refetching the eventually-consistent board', async () => {
    let releaseCreate!: () => void
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    const { invoke } = renderRoadmapView({
      roadmap_get_board: async () => staleBoard,
      roadmap_create_issue: async () => {
        await createGate
        return { issue: createdIssue }
      },
    })

    // Board loaded once the "No label / Other" column's add button appears.
    const addButton = await screen.findByRole('button', { name: 'Create issue with no label' })
    await fireEvent.click(addButton)

    // Fill the create dialog and submit, skipping AI refinement.
    await fireEvent.input(screen.getByLabelText('Describe the issue'), {
      target: { value: 'Newly created ticket' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Skip AI' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

    // Hold the backend response until the UI has entered its busy state. This
    // makes the test observe the full create lifecycle rather than racing the
    // asynchronous click handler before creation has actually started.
    await screen.findByRole('button', { name: 'Creating…' })
    releaseCreate()

    await waitFor(() => {
      const button = screen.getByRole('button', {
        name: 'Create issue with no label',
      }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    })

    // The optimistically inserted card must still be on the board.
    expect(screen.queryByText('Newly created ticket')).not.toBeNull()
    // ...and it must not have been wiped by a second, eventually-consistent board
    // fetch. Only the initial load should have hit roadmap_get_board.
    const boardFetches = invoke.mock.calls.filter(([method]) => method === 'roadmap_get_board').length
    expect(boardFetches).toBe(1)
  })

  it('ignores a create response from an earlier activation after switching away and back', async () => {
    let releaseCreate!: () => void
    let createCompleted = false
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    const dogBoard: RoadmapBoard = {
      ...staleBoard,
      repo: { owner: 'octo', name: 'dog' },
    }
    const { api, rerender } = renderRoadmapView({
      roadmap_get_board: async (payload) =>
        (payload as { projectId: string }).projectId === 'proj-2' ? dogBoard : staleBoard,
      roadmap_create_issue: async () => {
        await createGate
        createCompleted = true
        return { issue: createdIssue }
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Create issue with no label' }))
    await fireEvent.input(screen.getByLabelText('Describe the issue'), {
      target: { value: 'Newly created ticket' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Skip AI' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    await screen.findByRole('button', { name: 'Creating…' })

    await rerender({ api, projectId: 'proj-2', projectName: 'Dog' })
    expect(await screen.findByText('octo/dog')).toBeTruthy()
    await rerender({ api, projectId: 'proj-1', projectName: 'Cat again' })
    expect(await screen.findByText('octo/cat')).toBeTruthy()

    releaseCreate()
    await waitFor(() => expect(createCompleted).toBe(true))

    expect(screen.queryByText('Newly created ticket')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create issue' })).toBeNull()
  })
})
