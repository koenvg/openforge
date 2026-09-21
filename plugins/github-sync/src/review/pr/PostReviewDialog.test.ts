import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import PostReviewDialog from './PostReviewDialog.svelte'

const pr: ReviewPullRequest = {
  id: 1,
  number: 42,
  title: 'Review me',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/app/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'app',
  head_ref: 'feature',
  base_ref: 'main',
  head_sha: 'head',
  additions: 1,
  deletions: 0,
  changed_files: 1,
  ci_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  created_at: 1,
  updated_at: 1,
  viewed_at: 1,
  viewed_head_sha: 'head',
  reviewed_head_sha: 'head',
  labels: [],
}

describe('PostReviewDialog', () => {
  it('explains that keeping a successfully tracked review moves it to Reviewed', async () => {
    const onKeep = vi.fn()
    render(PostReviewDialog, { pr, onKeep, onRemove: vi.fn() })

    expect(screen.getByText(/move to the collapsed Reviewed group/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Keep in my list' }))
    expect(onKeep).toHaveBeenCalledOnce()
  })

  it('distinguishes GitHub success from a local tracking failure', () => {
    const trackingError = 'Your review was submitted to GitHub, but OpenForge could not save its local review status.'
    render(PostReviewDialog, { pr, trackingError, onKeep: vi.fn(), onRemove: vi.fn() })

    expect(screen.getByRole('status').textContent).toContain('submitted to GitHub')
    expect(screen.getByRole('status').textContent).toContain('could not save its local review status')
    expect(screen.queryByText(/move to the collapsed Reviewed group/)).toBeNull()
  })
})
