import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

const client = {
  getPrWalkthrough: vi.fn(),
  startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
  abortAgentWalkthrough: vi.fn(async () => {}),
  deletePrWalkthrough: vi.fn(async () => {}),
}

vi.mock('./githubSyncClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./githubSyncClient')>()
  return {
    ...actual,
    createGithubSyncPrReviewClient: () => client,
  }
})

vi.mock('../../lib/walkthroughGuidance', () => ({
  resolveWalkthroughGuidance: vi.fn(async () => ({ reviewGuidance: '', walkthroughGuidance: '' })),
}))

import PrReviewRowAction from './PrReviewRowAction.svelte'

const pr = {
  id: 1,
  number: 7,
  head_sha: 'sha-1',
  title: 'A PR',
  body: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'feature',
  base_ref: 'main',
} as unknown as ReviewPullRequest

const generatingRow: PrWalkthrough = {
  pr_id: 1,
  head_sha: 'sha-1',
  walkthrough_session_key: 'sess-1',
  status: 'generating',
  steps_json: null,
  error_message: null,
  created_at: 0,
  updated_at: 0,
}

function apiWithProjects(reposByProject: Record<string, string>): FrontendOpenForgeAPI {
  const idsByRepo = Object.fromEntries(Object.entries(reposByProject).map(([id, repo]) => [repo.toLowerCase(), id]))
  return {
    backend: {
      whenReady: vi.fn(async () => {}),
      invoke: vi.fn(async (method: string) => method === 'resolveProjectIdsByRepo' ? idsByRepo : null),
    },
  } as unknown as FrontendOpenForgeAPI
}

function renderRow(reposByProject: Record<string, string> = { 'matching-project': 'acme/repo' }) {
  const api = apiWithProjects(reposByProject)
  const rendered = render(PrReviewRowAction, {
    props: {
      api,
      context: {} as unknown as OpenForgeContextSnapshot,
      pr,
      projectId: 'active-project',
    },
  })
  return { api, rendered }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.getPrWalkthrough.mockResolvedValue(null)
})

describe('PrReviewRowAction availability', () => {
  it('does not offer generation when no local project matches the pull request repository', async () => {
    const { api } = renderRow({ 'active-project': 'acme/other' })

    await waitFor(() => expect(api.backend.invoke).toHaveBeenCalledWith('resolveProjectIdsByRepo', null))
    expect(screen.queryByRole('button', { name: /generate walkthrough and ai review/i })).toBeNull()
  })

  it('generates with the repository-matched project instead of the active project', async () => {
    renderRow({ 'active-project': 'acme/other', 'matching-project': 'acme/repo' })

    await fireEvent.click(await screen.findByRole('button', { name: /generate walkthrough and ai review/i }))

    expect(client.startAgentWalkthrough).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'matching-project',
      repoOwner: 'acme',
      repoName: 'repo',
    }))
  })
})

describe('PrReviewRowAction stop', () => {
  it('stops an in-flight generation and resets the row to idle', async () => {
    client.getPrWalkthrough.mockResolvedValue(generatingRow)
    renderRow()

    await fireEvent.click(await screen.findByRole('button', { name: /stop walkthrough generation/i }))

    expect(client.abortAgentWalkthrough).toHaveBeenCalledWith({ walkthroughSessionKey: 'sess-1' })
    expect(client.deletePrWalkthrough).toHaveBeenCalledWith({ reviewPrId: 1, headSha: 'sha-1' })
    expect(await screen.findByRole('button', { name: /generate walkthrough and ai review/i })).toBeTruthy()
  })
})
