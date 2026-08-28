import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import type { PluginTaskUISectionProps } from '@openforge-app/plugin-sdk/frontend'
import type { PollResult, PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
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
    merge_readiness_status: 'ready_to_merge',
    merge_readiness_action: 'merge',
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: 'abc123',
    merge_group_sha: null,
    required_checks_policy_known: true,
    required_reviews_policy_known: true,
    merge_queue_required: false,
    merge_queue_state: null,
    readiness_updated_at: 2000,
    merge_methods_policy_known: true,
    allowed_merge_methods: ['merge'],
    default_merge_method: 'merge',
    ...overrides,
  }
}

const reviewComment: PrComment = {
  id: 501,
  pr_id: 42,
  author: 'reviewer',
  body: 'Please update this code',
  comment_type: 'review_comment',
  file_path: 'src/main.ts',
  line_number: 12,
  addressed: 0,
  outdated: 0,
  created_at: 2000,
}

function renderSection(invoke: ReturnType<typeof vi.fn>, taskId = 'T-42') {
  const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.github-sync', projectId: 'P-1' })
  api.backend.whenReady = vi.fn(async () => undefined)
  api.backend.invoke = invoke
  const props: PluginTaskUISectionProps & { taskActionPending: boolean } = {
    api,
    context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId },
    taskId,
    projectId: 'P-1',
    taskActionPending: false,
  }
  return { api, ...render(TaskPullRequestStatus, { props }) }
}

async function openLinkForm(url = 'https://github.com/owner/repo/pull/42'): Promise<void> {
  await fireEvent.click(await screen.findByRole('button', { name: 'Add PR' }))
  await fireEvent.input(screen.getByLabelText('GitHub pull request URL'), { target: { value: url } })
}

describe('Task pull request regressions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks for confirmation before merging a pull request', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest()]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })
  
    renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: 'Create a merge commit' }))
  
    expect(screen.getByRole('dialog', { name: 'Merge pull request confirmation' })).toBeTruthy()
    expect(invoke.mock.calls.filter(([method]) => method === 'mergeTaskPullRequest')).toHaveLength(0)
  })

  it('shows an error when pull request comments cannot be loaded', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest({ unaddressed_comment_count: 1 })]
      if (method === 'getTaskPrComments') throw new Error('comments offline')
      return emptyPollResult
    })
  
    renderSection(invoke)
    await screen.findByText('Test PR')
  
    expect(await screen.findByText(/Could not load pull request comments.*comments offline/i)).toBeTruthy()
  })

  it('shows an error when marking a comment addressed fails', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest({ unaddressed_comment_count: 1 })]
      if (method === 'getTaskPrComments') return [reviewComment]
      if (method === 'markTaskPrCommentAddressed') throw new Error('write failed')
      return emptyPollResult
    })
  
    renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: '✓ Mark addressed' }))
  
    expect(await screen.findByText(/Could not mark comment addressed.*write failed/i)).toBeTruthy()
  })

  it('closes the link form when linking succeeds but the local reload fails', async () => {
    let listCalls = 0
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') {
        listCalls += 1
        if (listCalls === 1) return []
        throw new Error('reload failed')
      }
      if (method === 'linkTaskPullRequest') return createPullRequest()
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })
  
    renderSection(invoke)
    await openLinkForm()
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))
  
    await waitFor(() => expect(screen.queryByLabelText('GitHub pull request URL')).toBeNull())
  })

  it('discards an unfinished link form when the selected Task changes', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return []
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })
  
    const { api, rerender } = renderSection(invoke)
    await openLinkForm('https://github.com/owner/repo/pull/77')
  
    await rerender({
      api,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-99' },
      taskId: 'T-99',
      projectId: 'P-1',
      taskActionPending: false,
    })
  
    expect(screen.queryByLabelText('GitHub pull request URL')).toBeNull()
  })

  it('refreshes the original Task when navigation happens during linking', async () => {
    let resolveLink!: (pr: PullRequestInfo) => void
    const linkRequest = new Promise<PullRequestInfo>((resolve) => { resolveLink = resolve })
    const listCalls: string[] = []
    const invoke = vi.fn(async (method: string, payload?: { taskId?: string }) => {
      if (method === 'listTaskPullRequests') {
        listCalls.push(payload?.taskId ?? '')
        return []
      }
      if (method === 'linkTaskPullRequest') return linkRequest
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })
  
    const { api, rerender } = renderSection(invoke)
    await openLinkForm()
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))
    await waitFor(() => expect(invoke.mock.calls.some(([method]) => method === 'linkTaskPullRequest')).toBe(true))
  
    await rerender({
      api,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-99' },
      taskId: 'T-99',
      projectId: 'P-1',
      taskActionPending: false,
    })
    await waitFor(() => expect(listCalls.filter(taskId => taskId === 'T-99')).toHaveLength(1))
  
    resolveLink(createPullRequest())
  
    await waitFor(() => expect(listCalls.filter(taskId => taskId === 'T-42')).toHaveLength(2))
    expect(listCalls.filter(taskId => taskId === 'T-99')).toHaveLength(1)
  })

  it('refreshes GitHub before presenting a newly linked pull request', async () => {
    let listCalls = 0
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') {
        listCalls += 1
        return listCalls === 1 ? [] : [createPullRequest({ title: 'Hydrated title' })]
      }
      if (method === 'linkTaskPullRequest') {
        return createPullRequest({ title: 'owner/repo#42', head_sha: '' })
      }
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })
  
    renderSection(invoke)
    await openLinkForm()
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))
    await screen.findByText('Hydrated title')
  
    expect(invoke.mock.calls.filter(([method]) => method === 'refreshTaskGithubStatus')).toHaveLength(1)
  })

  it('warns when GitHub merged the pull request but local persistence failed', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest()]
      if (method === 'getTaskPrComments') return []
      if (method === 'mergeTaskPullRequest') {
        throw new Error('Pull request merged on GitHub, but local state could not be updated: database is locked')
      }
      return emptyPollResult
    })
  
    renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: 'Create a merge commit' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm Merge' }))
  
    expect(
      await screen.findByText(/Pull request merged on GitHub.*local state could not be updated/i),
    ).toBeTruthy()
  })
})
