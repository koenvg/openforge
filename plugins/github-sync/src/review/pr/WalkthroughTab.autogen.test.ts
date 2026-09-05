import { render, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrFileDiff, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

// Replace the heavy diff renderer with the shared stub used by the sibling tests.
vi.mock('@openforge-app/pr-review-ui/DiffViewer.svelte', async () => ({
  default: (await import('./__fixtures__/DiffViewerStub.svelte')).default,
}))


import WalkthroughTab from './__fixtures__/WalkthroughWorkspaceHarness.svelte'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'head-sha',
  additions: 5,
  deletions: 2,
  changed_files: 2,
  mergeable: null,
  mergeable_state: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

const fileA: PrFileDiff = {
  sha: 'file-sha-a',
  filename: 'src/main.rs',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n a\n+B0',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

function makeGithubSync(overrides: Partial<GithubSyncPrReviewClient> = {}): GithubSyncPrReviewClient {
  return {
    getPrWalkthrough: vi.fn(async () => null),
    startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
    abortAgentWalkthrough: vi.fn(async () => {}),
    deletePrWalkthrough: vi.fn(async () => {}),
    ...overrides,
  } as unknown as GithubSyncPrReviewClient
}

function renderWalkthrough(githubSync: GithubSyncPrReviewClient) {
  render(WalkthroughTab, {
    props: {
      api: {} as unknown as FrontendOpenForgeAPI,
      githubSync,
      pr: basePr,
      files: [fileA],
      fetchFileContents: vi.fn(async () => ({ oldContent: '', newContent: '' })),
      projectId: 'project-1',
      existingComments: [],
      pendingComments: [] as ReviewSubmissionComment[],
      onPendingCommentsChange: vi.fn(),
      agentComments: [],
      onAgentCommentsChange: vi.fn(),
      onUpdateAgentCommentStatus: vi.fn(),
      onOpenUrl: vi.fn(),
      onSubmitReview: vi.fn(async () => {}),
    },
  })
}

describe('WalkthroughTab does not auto-generate', () => {
  it('loads the cached walkthrough but never starts generation on open', async () => {
    const getPrWalkthrough = vi.fn(async () => null)
    const startAgentWalkthrough = vi.fn(async () => ({ walkthrough_session_key: 'k' }))
    const githubSync = makeGithubSync({ getPrWalkthrough, startAgentWalkthrough })

    renderWalkthrough(githubSync)

    // The tab still loads whatever is cached for this (pr, head_sha)...
    await waitFor(() => expect(getPrWalkthrough).toHaveBeenCalled())
    // ...but with no cache it must NOT auto-kick generation. Give the (old)
    // auto-generate path ample time (a macrotask + microtasks) to fire.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()

    expect(startAgentWalkthrough).not.toHaveBeenCalled()
  })
})
