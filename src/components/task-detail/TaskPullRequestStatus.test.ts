import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'
import type { PullRequestInfo } from '../../lib/types'

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('TaskPullRequestStatus', () => {
  it('renders PR links and titles', () => {
    render(TaskPullRequestStatus, { props: { taskPrs: [createPullRequest()] } })
    expect(screen.getByText('Test PR')).toBeTruthy()
    expect(screen.getByText('https://github.com/owner/repo/pull/42')).toBeTruthy()
  })
})
