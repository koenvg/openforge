import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk/frontend'
import type { PollResult, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'

const emptyPollResult: PollResult = {
  new_comments: 0,
  ci_changes: 0,
  review_changes: 0,
  pr_changes: 0,
  errors: 0,
  rate_limited: false,
  rate_limit_reset_at: null,
}

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 2000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    ...overrides,
  }
}

function renderSection(invoke: ReturnType<typeof vi.fn>) {
  const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.github-sync', projectId: 'P-1' })
  api.backend.whenReady = vi.fn(async () => undefined)
  api.backend.invoke = invoke
  const props: PluginTaskUISectionProps = {
    api,
    context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' },
    taskId: 'T-42',
    projectId: 'P-1',
  }
  return { api, ...render(TaskPullRequestStatus, { props }) }
}

describe('GitHub Sync Task pull request section', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads every linked pull request through same-plugin backend RPC', async () => {
    const first = createPullRequest()
    const second = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/other/pull/99', repo_name: 'other' })
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [first, second]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    const { api } = renderSection(invoke)

    expect(await screen.findByText('Test PR')).toBeTruthy()
    expect(screen.getByText('Second PR')).toBeTruthy()
    expect(api.backend.whenReady).toHaveBeenCalledOnce()
    expect(api.backend.invoke).toHaveBeenCalledWith('listTaskPullRequests', { taskId: 'T-42' })
    expect(screen.getByText('owner/repo')).toBeTruthy()
    expect(screen.getByText('owner/other')).toBeTruthy()
  })

  it('shows Merge versus Enqueue only for the eligible pull request', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [
        createPullRequest({ id: 1, pr_number: 1, title: 'Direct merge' }),
        createPullRequest({ id: 2, pr_number: 2, title: 'Merge queue', mergeable: null, mergeable_state: 'unknown', merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc123', readiness_updated_at: 2000 }),
        createPullRequest({ id: 3, pr_number: 3, title: 'Blocked', ci_status: 'pending' }),
      ]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    renderSection(invoke)

    expect((await screen.findAllByRole('button', { name: 'Merge' })).length).toBe(1)
    expect(screen.getAllByRole('button', { name: 'Enqueue' }).length).toBe(1)
  })

  it('requires confirmation, cancels without RPC, and suppresses duplicate merge requests', async () => {
    let resolveMerge!: () => void
    const mergeRequest = new Promise<void>((resolve) => { resolveMerge = resolve })
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest()]
      if (method === 'getTaskPrComments') return []
      if (method === 'mergeTaskPullRequest') return mergeRequest
      return emptyPollResult
    })

    renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    expect(screen.getByText('Merge owner/repo pull request #42 “Test PR”?')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invoke).not.toHaveBeenCalledWith('mergeTaskPullRequest', expect.anything())

    await fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm Merge' }))
    expect((screen.getByRole('button', { name: 'Merging…' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'Merging…' }))
    expect(invoke.mock.calls.filter(([method]) => method === 'mergeTaskPullRequest')).toHaveLength(1)

    resolveMerge()
    await waitFor(() => expect(screen.getByText('Pull request merged successfully.')).toBeTruthy())
  })
})
