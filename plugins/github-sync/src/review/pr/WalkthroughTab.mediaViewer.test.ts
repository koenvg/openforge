import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrFileDiff, PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

vi.mock('@openforge-app/pr-review-ui/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((options: { getCount: () => number }) => ({
    get virtualItems() {
      return Array.from({ length: options.getCount() }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
        end: (index + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    totalSize: 300,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

vi.mock('@openforge-app/pr-review-ui/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({ getDiffFile: () => undefined })),
}))


import WalkthroughTab from './__fixtures__/WalkthroughWorkspaceHarness.svelte'

const pr: ReviewPullRequest = {
  id: 123,
  number: 42,
  title: 'Video walkthrough',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'video',
  base_ref: 'main',
  head_sha: 'head-sha',
  additions: 0,
  deletions: 0,
  changed_files: 1,
  mergeable: null,
  mergeable_state: null,
  created_at: 1,
  updated_at: 1,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

const videoFile: PrFileDiff = {
  sha: 'video-sha',
  filename: 'assets/demo.mp4',
  status: 'modified',
  additions: 0,
  deletions: 0,
  changes: 1,
  patch: null,
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const walkthrough: PrWalkthrough = {
  pr_id: pr.id,
  head_sha: pr.head_sha,
  walkthrough_session_key: null,
  status: 'ready',
  steps_json: JSON.stringify({
    steps: [{
      id: 'video-step',
      title: 'Review the recording',
      summary: 'Compare both video revisions.',
      files: [{ filename: videoFile.filename, hunk_indexes: null }],
    }],
  }),
  error_message: null,
  created_at: 0,
  updated_at: 0,
}

describe('WalkthroughTab media viewer integration', () => {
  it('uses native controls for walkthrough video revisions', async () => {
    const githubSync = {
      getPrWalkthrough: vi.fn(async () => walkthrough),
      getPrTicket: vi.fn(async () => ({ snapshot: null, jiraConfigured: false })),
    } as unknown as GithubSyncPrReviewClient

    render(WalkthroughTab, {
      props: {
        api: {} as FrontendOpenForgeAPI,
        githubSync,
        pr,
        files: [videoFile],
        fetchFileContents: vi.fn(async () => ({
          oldContent: 'before-video',
          newContent: 'after-video',
          oldAvailability: { status: 'available' as const },
          newAvailability: { status: 'available' as const },
        })),
        resolveRepositoryImage: vi.fn(async () => null),
        projectId: 'project-1',
        existingComments: [],
        pendingComments: [],
        onPendingCommentsChange: vi.fn(),
        agentComments: [],
        onAgentCommentsChange: vi.fn(),
        onUpdateAgentCommentStatus: vi.fn(),
        onOpenUrl: vi.fn(),
        onSubmitReview: vi.fn(async () => {}),
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: '2' }))
    await screen.findByText('Review the recording')
    const video = await screen.findByLabelText('assets/demo.mp4 new preview') as HTMLVideoElement

    expect(screen.queryByRole('button', { name: 'Open assets/demo.mp4 after preview' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull()
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(false)
  })
})
