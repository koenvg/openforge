import { render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import RoadmapView from './RoadmapView.svelte'
import type { RoadmapBoard } from '../lib/types'

// Empty board: no issues means the repo slug only ever renders in the header
// subtitle (Board passes `repo` to a Card, which only exists when there are
// issues), so a query for the slug is unambiguous.
const board: RoadmapBoard = {
  repo: { owner: 'octo', name: 'cat' },
  issues: [],
  labels: [],
  values: {},
  columnLabels: [],
}

type InvokeHandlers = Record<string, (payload: unknown) => Promise<unknown>>

function makeApi(handlers: InvokeHandlers) {
  const invoke = vi.fn(async (method: string, payload?: unknown) => {
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
  const { api } = makeApi(handlers)
  render(RoadmapView, { props: { api, projectId: 'proj-1', projectName: 'Cat' } })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('RoadmapView header subtitle', () => {
  it('shows the resolved repo slug (owner/name), never "undefined/undefined"', async () => {
    renderView({ roadmap_get_board: async () => board })

    // Once the board loads, the subtitle under the title resolves to the repo
    // slug built from repo.owner/repo.name.
    expect(await screen.findByText('octo/cat')).toBeTruthy()
    expect(screen.queryByText('undefined/undefined')).toBeNull()
  })
})
