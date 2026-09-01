import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

const client = {
  getPrWalkthrough: vi.fn(),
  startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
  abortAgentWalkthrough: vi.fn(async () => {}),
  deletePrWalkthrough: vi.fn(async () => {}),
}

vi.mock('./githubSyncClient', () => ({
  createGithubSyncPrReviewClient: () => client,
}))

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

function renderRow() {
  return render(PrReviewRowAction, {
    props: {
      api: {} as unknown as FrontendOpenForgeAPI,
      context: {} as unknown as OpenForgeContextSnapshot,
      pr,
      projectId: null,
    },
  })
}

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
