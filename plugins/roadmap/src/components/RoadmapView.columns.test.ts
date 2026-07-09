import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import RoadmapView from './RoadmapView.svelte'
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

type InvokeHandlers = Record<string, (payload: unknown) => Promise<unknown>>

function makeApi(handlers: InvokeHandlers) {
  const invoke = vi.fn(async (method: string, payload?: unknown) => {
    // Mirror the Electron IPC boundary: payloads are structured-cloned, so a raw
    // Svelte $state proxy would throw "An object could not be cloned" here.
    const clonedPayload = structuredClone(payload)
    const handler = handlers[method]
    if (!handler) return null
    return handler(clonedPayload)
  })
  const api = {
    backend: {
      state: 'ready' as const,
      whenReady: async () => undefined,
      onReady: (h: () => void) => {
        h()
        return { dispose: () => undefined }
      },
      invoke,
    },
    system: { openUrl: vi.fn(async () => undefined) },
    projectConfig: { get: vi.fn(async () => null) },
  }
  return { api: api as unknown as FrontendOpenForgeAPI, invoke }
}

function renderView(handlers: InvokeHandlers) {
  const { api, invoke } = makeApi(handlers)
  render(RoadmapView, { props: { api, projectId: 'proj-1', projectName: 'Cat' } })
  return { invoke }
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
    renderView({
      roadmap_get_board: async () => board,
    })

    expect(await screen.findByText('octo/cat')).toBeTruthy()
    expect(screen.queryByText('undefined/undefined')).toBeNull()
  })

  it('saves the reordered labels and closes the dialog on success', async () => {
    const { invoke } = renderView({
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
    renderView({
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
