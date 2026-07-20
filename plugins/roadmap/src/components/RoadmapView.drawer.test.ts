import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import RoadmapView from './RoadmapView.svelte'
import type { RoadmapBoard } from '../lib/types'

const bug = { name: 'bug', color: 'd73a4a' }

function issue(number: number, title: string) {
  return {
    number,
    title,
    body: '',
    state: 'open',
    html_url: `https://github.com/octo/cat/issues/${number}`,
    labels: [bug],
  }
}

// No values → sortColumnCards orders by issue number descending: [12, 11, 10].
const board: RoadmapBoard = {
  repo: { owner: 'octo', name: 'cat' },
  issues: [issue(10, 'Ten'), issue(11, 'Eleven'), issue(12, 'Twelve')],
  labels: [bug],
  values: {},
  columnLabels: ['bug'],
}

const boardWithout11: RoadmapBoard = { ...board, issues: [issue(10, 'Ten'), issue(12, 'Twelve')] }

type InvokeHandlers = Record<string, (payload: unknown) => Promise<unknown>>

function makeApi(handlers: InvokeHandlers) {
  const invoke = vi.fn(async (method: string, payload?: unknown) => {
    const handler = handlers[method]
    if (!handler) return null
    return handler(structuredClone(payload))
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

afterEach(() => {
  vi.clearAllMocks()
})

describe('RoadmapView drawer group navigation', () => {
  it('opens the drawer on the clicked card with its position in the column', async () => {
    renderView({ roadmap_get_board: async () => board })

    await fireEvent.click(await screen.findByText('Eleven'))

    // Column order [12, 11, 10]; #11 is the 2nd of 3.
    expect(await screen.findByText('2 of 3 · bug')).toBeTruthy()
  })

  it('walks the frozen group with the pager', async () => {
    renderView({ roadmap_get_board: async () => board })

    await fireEvent.click(await screen.findByText('Twelve'))
    expect(await screen.findByText('1 of 3 · bug')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    expect(await screen.findByText('2 of 3 · bug')).toBeTruthy()
  })

  it('advances to the next issue when the open one is closed rather than closing the drawer', async () => {
    let closed = false
    renderView({
      roadmap_get_board: async () => (closed ? boardWithout11 : board),
      roadmap_edit_issue: async () => {
        closed = true
        return null
      },
    })

    await fireEvent.click(await screen.findByText('Eleven'))
    expect(await screen.findByText('2 of 3 · bug')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Close issue' }))

    // #11 gone; the reader advances to #10 (3rd of the frozen group) and the drawer stays open.
    expect(await screen.findByText('3 of 3 · bug')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close issue' })).toBeTruthy(),
    )
  })
})
