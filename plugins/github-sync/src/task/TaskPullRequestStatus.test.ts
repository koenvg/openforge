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
    merge_methods_policy_known: true,
    allowed_merge_methods: ['merge'],
    default_merge_method: 'merge',
    ...overrides,
  }
}

const baseComment: PrComment = {
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

function renderSection(invoke: ReturnType<typeof vi.fn>, taskActionPending = false) {
  const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.github-sync', projectId: 'P-1' })
  api.backend.whenReady = vi.fn(async () => undefined)
  api.backend.invoke = invoke
  const props: PluginTaskUISectionProps & { taskActionPending: boolean } = {
    api,
    context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' },
    taskId: 'T-42',
    projectId: 'P-1',
    taskActionPending,
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

  it('does not show merge-readiness blockers after the pull request is merged', async () => {
    const merged = createPullRequest({
      state: 'merged',
      merged_at: 3000,
      merge_readiness_status: 'blocked',
      merge_readiness_action: 'resolve_blockers',
      merge_readiness_blockers: [{ code: 'already_merged', message: 'Pull request is already merged.' }],
      readiness_source_head_sha: 'abc123',
      readiness_updated_at: 3000,
    })
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [merged]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    renderSection(invoke)

    expect(await screen.findByText('Test PR')).toBeTruthy()
    expect(screen.getByText('merged')).toBeTruthy()
    expect(screen.queryByText('Pull request is already merged.')).toBeNull()
  })

  it('renders cached pull requests immediately while revalidating them when returning to a task', async () => {
    let resolveTaskARefresh!: (pullRequests: PullRequestInfo[]) => void
    const taskARefresh = new Promise<PullRequestInfo[]>((resolve) => { resolveTaskARefresh = resolve })
    const taskAPr = createPullRequest({ title: 'Task A PR' })
    const refreshedTaskAPr = createPullRequest({ title: 'Refreshed Task A PR', updated_at: 3000 })
    let taskALoads = 0
    const taskBPr = createPullRequest({ id: 43, pr_number: 43, ticket_id: 'T-43', title: 'Task B PR' })
    const invoke = vi.fn(async (method: string, payload?: { taskId?: string; prId?: number }) => {
      if (method === 'listTaskPullRequests') {
        if (payload?.taskId === 'T-43') return [taskBPr]
        taskALoads += 1
        return taskALoads === 1 ? [taskAPr] : taskARefresh
      }
      if (method === 'getTaskPrComments') return payload?.prId === taskAPr.id ? [baseComment] : []
      return emptyPollResult
    })

    const { api, rerender } = renderSection(invoke)
    expect(await screen.findByText('Task A PR')).toBeTruthy()
    expect(await screen.findByText(baseComment.body)).toBeTruthy()

    await rerender({
      api,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-43' },
      taskId: 'T-43',
      projectId: 'P-1',
    })
    expect(await screen.findByText('Task B PR')).toBeTruthy()

    await rerender({
      api,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' },
      taskId: 'T-42',
      projectId: 'P-1',
    })

    expect(screen.getByText('Task A PR')).toBeTruthy()
    expect(screen.getByText(baseComment.body)).toBeTruthy()
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && payload.taskId === 'T-42')).toHaveLength(2)
    })
    resolveTaskARefresh([refreshedTaskAPr])
    expect(await screen.findByText('Refreshed Task A PR')).toBeTruthy()
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'getTaskPrComments' && payload.prId === taskAPr.id)).toHaveLength(2)
  })

  it('coalesces concurrent task loads and never renders a stale response over the selected task', async () => {
    let resolveTaskA!: (pullRequests: PullRequestInfo[]) => void
    const taskARequest = new Promise<PullRequestInfo[]>((resolve) => { resolveTaskA = resolve })
    const taskAPr = createPullRequest({ title: 'Delayed Task A PR' })
    const taskBPr = createPullRequest({ id: 43, pr_number: 43, ticket_id: 'T-43', title: 'Current Task B PR' })
    const invoke = vi.fn(async (method: string, payload?: { taskId?: string; prId?: number }) => {
      if (method === 'listTaskPullRequests') return payload?.taskId === 'T-42' ? taskARequest : [taskBPr]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    const { api, rerender } = renderSection(invoke)
    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-43' }, taskId: 'T-43', projectId: 'P-1' })
    expect(await screen.findByText('Current Task B PR')).toBeTruthy()

    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' }, taskId: 'T-42', projectId: 'P-1' })
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && payload.taskId === 'T-42')).toHaveLength(1)

    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-43' }, taskId: 'T-43', projectId: 'P-1' })
    resolveTaskA([taskAPr])
    await waitFor(() => expect(screen.getByText('Current Task B PR')).toBeTruthy())
    await waitFor(() => expect(invoke.mock.calls.filter(([method, payload]) => method === 'getTaskPrComments' && payload.prId === taskAPr.id)).toHaveLength(1))
    expect(screen.queryByText('Delayed Task A PR')).toBeNull()

    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' }, taskId: 'T-42', projectId: 'P-1' })
    expect(screen.getByText('Delayed Task A PR')).toBeTruthy()
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && payload.taskId === 'T-42')).toHaveLength(2)
  })

  it('refreshes visible data after a pushed GitHub Sync event and revalidates cached tasks when revisited', async () => {
    let resolveTaskBRefresh!: (pullRequests: PullRequestInfo[]) => void
    const taskBRefresh = new Promise<PullRequestInfo[]>((resolve) => { resolveTaskBRefresh = resolve })
    const taskAPr = createPullRequest({ title: 'Hidden Task A PR' })
    const taskBOld = createPullRequest({ id: 43, pr_number: 43, ticket_id: 'T-43', title: 'Cached Task B PR' })
    const taskBNew = createPullRequest({ id: 43, pr_number: 43, ticket_id: 'T-43', title: 'Refreshed Task B PR', updated_at: 3000 })
    const taskBOldComment = { ...baseComment, id: 601, pr_id: 43, body: 'Cached Task B comment' }
    const taskBNewComment = { ...taskBOldComment, body: 'Refreshed Task B comment' }
    let taskBLoads = 0
    let taskBCommentLoads = 0
    const invoke = vi.fn(async (method: string, payload?: { taskId?: string; prId?: number }) => {
      if (method === 'listTaskPullRequests' && payload?.taskId === 'T-42') return [taskAPr]
      if (method === 'listTaskPullRequests' && payload?.taskId === 'T-43') {
        taskBLoads += 1
        return taskBLoads === 1 ? [taskBOld] : taskBRefresh
      }
      if (method === 'getTaskPrComments' && payload?.prId === taskBOld.id) {
        taskBCommentLoads += 1
        return taskBCommentLoads === 1 ? [taskBOldComment] : [taskBNewComment]
      }
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    const { api, rerender } = renderSection(invoke)
    expect(await screen.findByText('Hidden Task A PR')).toBeTruthy()
    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-43' }, taskId: 'T-43', projectId: 'P-1' })
    expect(await screen.findByText('Cached Task B PR')).toBeTruthy()
    expect(await screen.findByText('Cached Task B comment')).toBeTruthy()

    await api.events.emitGlobal('openforge.github-sync-complete', emptyPollResult)
    await waitFor(() => expect(taskBLoads).toBe(2))
    expect(screen.getByText('Cached Task B PR')).toBeTruthy()
    expect(screen.getByText('Cached Task B comment')).toBeTruthy()
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && payload.taskId === 'T-42')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([method]) => method === 'refreshTaskGithubStatus')).toHaveLength(0)

    resolveTaskBRefresh([taskBNew])
    expect(await screen.findByText('Refreshed Task B PR')).toBeTruthy()
    expect(await screen.findByText('Refreshed Task B comment')).toBeTruthy()

    await rerender({ api, context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-42' }, taskId: 'T-42', projectId: 'P-1' })
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && payload.taskId === 'T-42')).toHaveLength(2)
    })
  })

  it('does not flash a loading message while switching quickly to another task', async () => {
    let resolveNextTask!: (pullRequests: PullRequestInfo[]) => void
    const nextTaskRequest = new Promise<PullRequestInfo[]>((resolve) => { resolveNextTask = resolve })
    const invoke = vi.fn(async (method: string, payload?: { taskId?: string }) => {
      if (method === 'listTaskPullRequests') {
        return payload?.taskId === 'T-43' ? nextTaskRequest : []
      }
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    const { api, rerender } = renderSection(invoke)
    expect(await screen.findByText('No linked pull requests yet')).toBeTruthy()

    await rerender({
      api,
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-43' },
      taskId: 'T-43',
      projectId: 'P-1',
    })

    expect(screen.queryByText('No linked pull requests yet')).toBeNull()
    expect(screen.queryByText('Loading pull requests…')).toBeNull()

    resolveNextTask([])
    expect(await screen.findByText('No linked pull requests yet')).toBeTruthy()
    expect(screen.queryByText('Loading pull requests…')).toBeNull()
  })

  it('shows loading feedback when a task pull request lookup is slow', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return new Promise<PullRequestInfo[]>(() => {})
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    renderSection(invoke)

    expect(screen.queryByText('Loading pull requests…')).toBeNull()
    expect(await screen.findByText('Loading pull requests…', {}, { timeout: 600 })).toBeTruthy()
  })

  it('manual refresh invokes GitHub Sync and then bypasses the local cache', async () => {
    let localLoads = 0
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') {
        localLoads += 1
        return [createPullRequest({ title: `Task PR version ${localLoads}` })]
      }
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    renderSection(invoke)
    expect(await screen.findByText('Task PR version 1')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh GitHub status' }))

    expect(await screen.findByText('Task PR version 2')).toBeTruthy()
    expect(invoke.mock.calls.filter(([method]) => method === 'refreshTaskGithubStatus')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([method]) => method === 'listTaskPullRequests')).toHaveLength(2)
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

    expect((await screen.findAllByRole('button', { name: 'Create a merge commit' })).length).toBe(1)
    expect(screen.getAllByRole('button', { name: 'Enqueue' }).length).toBe(1)
  })

  it('starts a merge with the GitHub default method, shows progress, and suppresses duplicate requests', async () => {
    let resolveMerge!: () => void
    const mergeRequest = new Promise<void>((resolve) => { resolveMerge = resolve })
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest({
        merge_methods_policy_known: true,
        allowed_merge_methods: ['squash'],
        default_merge_method: 'squash',
      })]
      if (method === 'getTaskPrComments') return []
      if (method === 'mergeTaskPullRequest') return mergeRequest
      return emptyPollResult
    })

    renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: 'Squash and merge' }))

    expect(screen.queryByText('Merge owner/repo pull request #42 “Test PR”?')).toBeNull()
    expect((screen.getByRole('button', { name: 'Merging…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: 'Merging pull request' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Merging…' }))
    expect(invoke.mock.calls.filter(([method]) => method === 'mergeTaskPullRequest')).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('mergeTaskPullRequest', {
      taskId: 'T-42',
      prId: 42,
      expectedHeadSha: 'abc123',
      mergeMethod: 'squash',
    })

    resolveMerge()
    await waitFor(() => expect(screen.getByText('Pull request merged successfully.')).toBeTruthy())
  })

  it('shows merge progress for an action started outside the pull request section', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [createPullRequest()]
      if (method === 'getTaskPrComments') return []
      return emptyPollResult
    })

    renderSection(invoke, true)

    expect((await screen.findByRole('button', { name: 'Merging…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: 'Merging pull request' })).toBeTruthy()
  })
  it('keeps an in-flight action bound to its original Task without forcing GitHub Sync', async () => {
    let resolveMerge!: () => void
    const mergeRequest = new Promise<void>((resolve) => { resolveMerge = resolve })
    const invoke = vi.fn(async (method: string, payload?: unknown) => {
      if (method === 'listTaskPullRequests') {
        const { taskId } = payload as { taskId: string }
        return taskId === 'T-42'
          ? [createPullRequest()]
          : [createPullRequest({ id: 99, pr_number: 99, ticket_id: 'T-99', title: 'Other Task PR' })]
      }
      if (method === 'getTaskPrComments') return []
      if (method === 'mergeTaskPullRequest') return mergeRequest
      return emptyPollResult
    })

    const { rerender } = renderSection(invoke)
    await fireEvent.click(await screen.findByRole('button', { name: 'Create a merge commit' }))
    await rerender({
      taskId: 'T-99',
      projectId: 'P-1',
      context: { pluginId: 'com.openforge.github-sync', projectId: 'P-1', taskId: 'T-99' },
      taskActionPending: false,
    })
    expect(await screen.findByText('Other Task PR')).toBeTruthy()

    resolveMerge()
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([method, payload]) => method === 'listTaskPullRequests' && (payload as { taskId: string }).taskId === 'T-42')).toHaveLength(2)
    })

    expect(invoke.mock.calls.filter(([method]) => method === 'mergeTaskPullRequest')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([method]) => method === 'refreshTaskGithubStatus')).toHaveLength(0)
    expect(screen.queryByText('Pull request merged successfully.')).toBeNull()
  })

  it('resolves GitHub uploads pasted into an unaddressed review comment', async () => {
    const uploadUrl = 'https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3'
    const signedUrl = 'https://private-user-images.githubusercontent.com/1/shot.png?jwt=signed'
    const pr = createPullRequest({ unaddressed_comment_count: 1 })
    const invoke = vi.fn(async (method: string) => {
      if (method === 'listTaskPullRequests') return [pr]
      if (method === 'getTaskPrComments') return [{ ...baseComment, body: `![Screenshot](${uploadUrl})` }]
      if (method === 'resolveGithubAsset') return { url: signedUrl, kind: 'image' }
      return emptyPollResult
    })

    renderSection(invoke)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Screenshot' }).getAttribute('src')).toBe(signedUrl)
    })
    expect(invoke).toHaveBeenCalledWith('resolveGithubAsset', {
      owner: pr.repo_owner,
      repo: pr.repo_name,
      url: uploadUrl,
    })
  })
})
