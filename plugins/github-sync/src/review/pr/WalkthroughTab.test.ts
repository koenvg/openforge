import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrFileDiff, PrWalkthrough, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

// Replace the heavy diff renderer with a stub that records the props WalkthroughTab
// forwards, and renders the footer snippet (where the submit panel lives in Task 3).
vi.mock('@openforge-app/pr-review-ui/DiffViewer.svelte', async () => ({
  default: (await import('./__fixtures__/DiffViewerStub.svelte')).default,
}))

vi.mock('../../lib/domUtils', () => ({
  isInputFocused: () => false,
}))

import WalkthroughTab from './WalkthroughTab.svelte'

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

const fileB: PrFileDiff = {
  sha: 'file-sha-b',
  filename: 'src/checkout.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n a\n+B0',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

function makeWalkthrough(): PrWalkthrough {
  return {
    pr_id: basePr.id,
    head_sha: basePr.head_sha,
    walkthrough_session_key: null,
    status: 'ready',
    steps_json: JSON.stringify({
      steps: [
        { id: 's1', title: 'Step one', summary: 'First concept', files: [{ filename: 'src/main.rs', hunk_indexes: null }] },
        { id: 's2', title: 'Step two', summary: 'Second concept', files: [{ filename: 'src/checkout.ts', hunk_indexes: null }] },
      ],
    }),
    error_message: null,
    created_at: 0,
    updated_at: 0,
  }
}

function makeGithubSync(): GithubSyncPrReviewClient {
  return {
    getPrWalkthrough: vi.fn(async () => makeWalkthrough()),
    startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
    abortAgentWalkthrough: vi.fn(async () => {}),
    deletePrWalkthrough: vi.fn(async () => {}),
  } as unknown as GithubSyncPrReviewClient
}

function renderWalkthrough(overrides: Record<string, unknown> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onSubmitReview = vi.fn(async () => {})
  render(WalkthroughTab, {
    props: {
      api: {} as unknown as FrontendOpenForgeAPI,
      githubSync: makeGithubSync(),
      pr: basePr,
      files: [fileA, fileB],
      fetchFileContents: vi.fn(async () => ({ oldContent: '', newContent: '' })),
      resolveRepositoryImage: vi.fn(async () => null),
      projectId: 'project-1',
      existingComments: [],
      pendingComments: [] as ReviewSubmissionComment[],
      onPendingCommentsChange,
      agentComments: [],
      onAgentCommentsChange: vi.fn(),
      onUpdateAgentCommentStatus: vi.fn(),
      onOpenUrl: vi.fn(),
      onSubmitReview,
      ...overrides,
    },
  })
  return { onPendingCommentsChange, onSubmitReview }
}

describe('WalkthroughTab comment sync', () => {
  it('forwards the shared pending-comment change handler to the per-step diff viewer', async () => {
    const { onPendingCommentsChange } = renderWalkthrough()
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByTestId('stub-add-pending'))

    expect(onPendingCommentsChange).toHaveBeenCalledWith([
      { path: 'stub.ts', line: 1, side: 'RIGHT', body: 'stub comment' },
    ])
  })

  it('feeds only the current step files to the per-step diff viewer', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    const stub = screen.getByTestId('diff-viewer-stub')
    expect(stub.getAttribute('data-file-count')).toBe('1')
    expect(within(stub).getByText('src/main.rs')).toBeTruthy()
    expect(within(stub).queryByText('src/checkout.ts')).toBeNull()
  })
})

describe('WalkthroughTab review/submit step', () => {
  it('adds a trailing Review & submit step beyond the parsed steps', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    // 2 parsed steps + 1 review/submit step.
    expect(screen.getByText('of 3')).toBeTruthy()
    // The submit panel is not shown on a normal step.
    expect(screen.queryByText('Submit Review')).toBeNull()
  })

  it('renders the full diff and the submit panel on the final step', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByRole('button', { name: '3' }))

    expect(await screen.findByText('Review & submit')).toBeTruthy()
    const stub = screen.getByTestId('diff-viewer-stub')
    expect(stub.getAttribute('data-file-count')).toBe('2')
    expect(within(stub).getByText('src/main.rs')).toBeTruthy()
    expect(within(stub).getByText('src/checkout.ts')).toBeTruthy()
    expect(screen.getByText('Submit Review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('submits the pending review from the final step', async () => {
    const comment: ReviewSubmissionComment = { path: 'src/main.rs', line: 2, side: 'RIGHT', body: 'nit' }
    const { onSubmitReview } = renderWalkthrough({ pendingComments: [comment] })
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByRole('button', { name: '3' }))
    await screen.findByText('Review & submit')
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'COMMENT',
        comments: [comment],
        prNumber: basePr.number,
        commitId: basePr.head_sha,
        repoOwner: basePr.repo_owner,
        repoName: basePr.repo_name,
      }),
    )
  })
})
