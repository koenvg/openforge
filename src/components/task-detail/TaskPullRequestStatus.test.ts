import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrComment, PullRequestInfo } from '../../lib/types'

vi.mock('../../lib/ipc', () => ({
  forceGithubSync: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  refreshTaskGithubStatus: vi.fn().mockResolvedValue({
    new_comments: 0,
    ci_changes: 0,
    review_changes: 0,
    pr_changes: 0,
    errors: 0,
    rate_limited: false,
    rate_limit_reset_at: null,
  }),
  getPullRequests: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  linkPullRequest: vi.fn().mockResolvedValue(undefined),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
  enqueuePullRequest: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import * as ipc from '../../lib/ipc'
import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'

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

function createComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    pr_id: 42,
    author: 'reviewer',
    body: 'Please fix this.',
    comment_type: 'review',
    file_path: 'src/App.svelte',
    line_number: 42,
    addressed: 0,
    outdated: 0,
    created_at: 1000,
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('TaskPullRequestStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ipc.forceGithubSync).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    })
    vi.mocked(ipc.refreshTaskGithubStatus).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    })
    vi.mocked(ipc.getPullRequests).mockResolvedValue([])
    vi.mocked(ipc.getPrComments).mockResolvedValue([])
    vi.mocked(ipc.markCommentAddressed).mockResolvedValue(undefined)
    vi.mocked(ipc.linkPullRequest).mockResolvedValue(createPullRequest())
    vi.mocked(ipc.mergePullRequest).mockResolvedValue(undefined)
    vi.mocked(ipc.enqueuePullRequest).mockResolvedValue(undefined)
    vi.mocked(ipc.openUrl).mockResolvedValue(undefined)
  })

  it('renders PR links and titles', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest()] } })
    expect(screen.getByText('Test PR')).toBeTruthy()
    expect(screen.getByText('https://github.com/owner/repo/pull/42')).toBeTruthy()
  })

  it('omits the comment chip when there are no unaddressed comments', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest({ unaddressed_comment_count: 0 })] } })

    expect(screen.queryByText('0 comments')).toBeNull()
    expect(screen.queryByText(/\bcomments?\b/)).toBeNull()
  })

  it('renders a comment chip with the unaddressed comment count when greater than zero', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest({ unaddressed_comment_count: 2 })] } })

    expect(screen.getByText('2 comments')).toBeTruthy()
  })

  it('renders a singular comment chip for a single unaddressed comment', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest({ unaddressed_comment_count: 1 })] } })

    expect(screen.getByText('1 comment')).toBeTruthy()
  })

  it('does not render a placeholder when a PR has no CI/review signals and no comments', () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ ci_status: null, review_status: null, unaddressed_comment_count: 0 })],
      },
    })

    expect(screen.queryByText('No CI or review signals')).toBeNull()
  })

  it('labels merged PR cards as done instead of active pull requests', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest({ state: 'merged', merged_at: 3000 })] } })

    expect(screen.getByLabelText('Merged pull request #42 (done)')).toBeTruthy()
  })

  it('labels closed PR cards distinctly from merged/done pull requests', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest({ state: 'closed', merged_at: null })] } })

    expect(screen.getByLabelText('Closed pull request #42 (not merged)')).toBeTruthy()
    expect(screen.getByText('closed')).toBeTruthy()
    expect(screen.queryByLabelText('Merged pull request #42 (done)')).toBeNull()
    expect(screen.queryByText('merged')).toBeNull()
  })

  it('opens PR links through the typed openUrl IPC wrapper', async () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest()] } })

    await fireEvent.click(screen.getByText('https://github.com/owner/repo/pull/42'))

    expect(ipc.openUrl).toHaveBeenCalledWith('https://github.com/owner/repo/pull/42')
  })

  it('refreshes GitHub status for the current task and reloads linked pull requests', async () => {
    const onGithubStatusRefreshed = vi.fn().mockResolvedValue(undefined)
    render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [createPullRequest()], onGithubStatusRefreshed },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh GitHub status' }))

    await waitFor(() => {
      expect(ipc.refreshTaskGithubStatus).toHaveBeenCalledWith('T-42')
      expect(onGithubStatusRefreshed).toHaveBeenCalled()
    })
  })

  it('keeps pull request cards visible and reports task-scoped refresh failures', async () => {
    vi.mocked(ipc.refreshTaskGithubStatus).mockRejectedValueOnce(new Error('GitHub rate limit'))
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest()] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh GitHub status' }))

    await waitFor(() => {
      expect(screen.getByText('Test PR')).toBeTruthy()
      expect(screen.getByText('Could not refresh GitHub status: GitHub rate limit')).toBeTruthy()
    })
  })

  it('links a GitHub pull request URL for the current task from the empty state', async () => {
    const onPullRequestLinked = vi.fn().mockResolvedValue(undefined)
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [], onPullRequestLinked } })

    await fireEvent.click(screen.getByRole('button', { name: 'Add PR' }))
    await fireEvent.input(screen.getByLabelText('GitHub pull request URL'), {
      target: { value: ' https://github.com/owner/repo/pull/123 ' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))

    await waitFor(() => {
      expect(ipc.linkPullRequest).toHaveBeenCalledWith('T-42', 'https://github.com/owner/repo/pull/123')
      expect(onPullRequestLinked).toHaveBeenCalled()
    })
    expect(screen.queryByLabelText('GitHub pull request URL')).toBeNull()
  })

  it('keeps the Add PR form open and displays link errors', async () => {
    vi.mocked(ipc.linkPullRequest).mockRejectedValueOnce(new Error('Invalid pull request URL'))
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Add PR' }))
    await fireEvent.input(screen.getByLabelText('GitHub pull request URL'), {
      target: { value: 'not-a-github-pr' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid pull request URL')).toBeTruthy()
    })
    expect(screen.getByLabelText('GitHub pull request URL')).toBeTruthy()
  })

  it('lets users add another pull request when the task already has one', async () => {
    const onPullRequestLinked = vi.fn().mockResolvedValue(undefined)
    render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [createPullRequest()], onPullRequestLinked },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Add PR' }))
    await fireEvent.input(screen.getByLabelText('GitHub pull request URL'), {
      target: { value: ' https://github.com/owner/repo/pull/99 ' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Link PR' }))

    await waitFor(() => {
      expect(ipc.linkPullRequest).toHaveBeenCalledWith('T-42', 'https://github.com/owner/repo/pull/99')
      expect(onPullRequestLinked).toHaveBeenCalled()
    })
    expect(screen.queryByLabelText('GitHub pull request URL')).toBeNull()
  })

  it('fetches comments for every PR and renders only unaddressed comments', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR', unaddressed_comment_count: 1 })
    const secondPr = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99', unaddressed_comment_count: 1 })
    vi.mocked(ipc.getPrComments).mockImplementation(async (prId: number) => {
      if (prId === 42) {
        return [
          createComment({ id: 1, pr_id: 42, author: 'alice', body: 'Fix first PR', addressed: 0 }),
          createComment({ id: 2, pr_id: 42, author: 'bob', body: 'Already handled', addressed: 1 }),
        ]
      }
      return [createComment({ id: 3, pr_id: 99, author: 'carol', body: 'Fix second PR', addressed: 0 })]
    })

    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [firstPr, secondPr] } })

    await waitFor(() => {
      expect(ipc.getPrComments).toHaveBeenCalledWith(42)
      expect(ipc.getPrComments).toHaveBeenCalledWith(99)
      expect(screen.getByText('Fix first PR')).toBeTruthy()
      expect(screen.getByText('Fix second PR')).toBeTruthy()
    })
    expect(screen.queryByText('Already handled')).toBeNull()
    expect(screen.queryByRole('button', { name: /mark addressed/i })).toBeNull()
  })

  it('marks comments addressed and refreshes when comment addressing is enabled', async () => {
    const comment = createComment({ id: 123, body: 'Focus-board triage comment', addressed: 0 })
    vi.mocked(ipc.getPrComments).mockResolvedValue([comment])

    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ unaddressed_comment_count: 1 })],
        allowCommentAddressing: true,
      },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /mark addressed/i })).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: /mark addressed/i }))

    await waitFor(() => {
      expect(ipc.markCommentAddressed).toHaveBeenCalledWith(123)
      expect(ipc.getPrComments).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps a comment visible and retryable when marking it addressed fails', async () => {
    const comment = createComment({ id: 124, body: 'Retry this comment', addressed: 0 })
    vi.mocked(ipc.getPrComments)
      .mockResolvedValueOnce([comment])
      .mockResolvedValueOnce([])
    vi.mocked(ipc.markCommentAddressed)
      .mockRejectedValueOnce(new Error('mark request failed'))
      .mockResolvedValueOnce(undefined)

    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ unaddressed_comment_count: 1 })],
        allowCommentAddressing: true,
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: /mark addressed/i }))

    await waitFor(() => {
      expect(screen.getByText('Retry this comment')).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toContain('mark request failed')
      expect(screen.getByRole('button', { name: 'Retry mark addressed' })).toBeTruthy()
    })
    expect(ipc.getPrComments).toHaveBeenCalledTimes(1)

    await fireEvent.click(screen.getByRole('button', { name: 'Retry mark addressed' }))

    await waitFor(() => {
      expect(ipc.markCommentAddressed).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Retry this comment')).toBeNull()
    })
  })

  it('keeps a comment visible and retryable when refreshing after addressing fails', async () => {
    const comment = createComment({ id: 125, body: 'Refresh failed comment', addressed: 0 })
    vi.mocked(ipc.getPrComments)
      .mockResolvedValueOnce([comment])
      .mockRejectedValueOnce(new Error('comment refresh failed'))
      .mockResolvedValueOnce([])

    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ unaddressed_comment_count: 1 })],
        allowCommentAddressing: true,
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: /mark addressed/i }))

    await waitFor(() => {
      expect(screen.getByText('Refresh failed comment')).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toContain('comment refresh failed')
      expect(screen.getByRole('button', { name: 'Retry mark addressed' })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry mark addressed' }))

    await waitFor(() => {
      expect(ipc.markCommentAddressed).toHaveBeenCalledTimes(2)
      expect(ipc.getPrComments).toHaveBeenCalledTimes(3)
      expect(screen.queryByText('Refresh failed comment')).toBeNull()
    })
  })

  it('refreshes only the addressed comment PR so unrelated PR failures cannot remove its retry state', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR', unaddressed_comment_count: 1 })
    const secondPr = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99' })
    const comment = createComment({ id: 126, pr_id: 42, body: 'First PR comment' })
    let firstPrLoads = 0
    let secondPrLoads = 0
    vi.mocked(ipc.getPrComments).mockImplementation(async (prId: number) => {
      if (prId === 42) {
        firstPrLoads += 1
        return firstPrLoads === 1 ? [comment] : []
      }
      secondPrLoads += 1
      if (secondPrLoads > 1) throw new Error('unrelated PR refresh failed')
      return []
    })

    render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [firstPr, secondPr], allowCommentAddressing: true },
    })

    await fireEvent.click(await screen.findByRole('button', { name: /mark addressed/i }))

    await waitFor(() => {
      expect(screen.queryByText('First PR comment')).toBeNull()
    })
    expect(firstPrLoads).toBe(2)
    expect(secondPrLoads).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('applies concurrent addressed-comment refreshes independently across PRs', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR', unaddressed_comment_count: 1 })
    const secondPr = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99', unaddressed_comment_count: 1 })
    const firstRefresh = createDeferred<PrComment[]>()
    const secondRefresh = createDeferred<PrComment[]>()
    let firstPrLoads = 0
    let secondPrLoads = 0
    vi.mocked(ipc.getPrComments).mockImplementation((prId: number) => {
      if (prId === 42) {
        firstPrLoads += 1
        return firstPrLoads === 1
          ? Promise.resolve([createComment({ id: 127, pr_id: 42, author: 'first', body: 'First concurrent comment' })])
          : firstRefresh.promise
      }
      secondPrLoads += 1
      return secondPrLoads === 1
        ? Promise.resolve([createComment({ id: 128, pr_id: 99, author: 'second', body: 'Second concurrent comment' })])
        : secondRefresh.promise
    })

    render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [firstPr, secondPr], allowCommentAddressing: true },
    })

    await screen.findByText('First concurrent comment')
    await screen.findByText('Second concurrent comment')
    const buttons = screen.getAllByRole('button', { name: /mark addressed/i })
    await fireEvent.click(buttons[0])
    await fireEvent.click(buttons[1])

    secondRefresh.resolve([])
    await waitFor(() => {
      expect(screen.queryByText('Second concurrent comment')).toBeNull()
      expect(screen.getByText('First concurrent comment')).toBeTruthy()
    })

    firstRefresh.resolve([])
    await waitFor(() => {
      expect(screen.queryByText('First concurrent comment')).toBeNull()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders deeply nested comment paths with the shared address control', async () => {
    const deeplyNestedPath = 'packages/classspotter-backoffice/src/features/remediation/schedule-url-change/components/review-panel/very/deeply/nested/ReviewCommentResolutionTimeline.svelte'
    vi.mocked(ipc.getPrComments).mockResolvedValue([
      createComment({
        id: 456,
        file_path: deeplyNestedPath,
        line_number: 318,
        body: 'Shared task-view comment renderer keeps this long-path comment addressable.',
      }),
    ])

    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ unaddressed_comment_count: 1 })],
        allowCommentAddressing: true,
      },
    })

    const commentArticle = await screen.findByLabelText('Comment by reviewer')
    expect(commentArticle.textContent).toContain(`${deeplyNestedPath}:318`)
    expect(commentArticle.textContent).toContain('Shared task-view comment renderer keeps this long-path comment addressable.')

    const markAddressedButton = screen.getByRole('button', { name: /mark addressed/i })
    expect(markAddressedButton).toBeTruthy()
    await fireEvent.click(markAddressedButton)

    await waitFor(() => {
      expect(ipc.markCommentAddressed).toHaveBeenCalledWith(456)
    })
  })

  it('resolves relative comment images against the related PR head commit', async () => {
    vi.mocked(ipc.getPrComments).mockResolvedValue([
      createComment({ body: '![Screenshot](docs/review.png)' }),
    ])

    const { container } = render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [createPullRequest({ repo_owner: 'org', repo_name: 'repo', head_sha: 'def456' })] },
    })

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('https://raw.githubusercontent.com/org/repo/def456/docs/review.png')
    })
  })

  it('continues rendering PR cards when loading comments for one PR fails', async () => {
    const firstPr = createPullRequest({ id: 42, title: 'First PR' })
    const secondPr = createPullRequest({ id: 99, pr_number: 99, title: 'Second PR', url: 'https://github.com/owner/repo/pull/99' })
    vi.mocked(ipc.getPrComments).mockImplementation(async (prId: number) => {
      if (prId === 42) throw new Error('network failed')
      return [createComment({ id: 3, pr_id: 99, author: 'carol', body: 'Second PR comment', addressed: 0 })]
    })

    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [firstPr, secondPr] } })

    await waitFor(() => {
      expect(screen.getByText('First PR')).toBeTruthy()
      expect(screen.getByText('Second PR')).toBeTruthy()
      expect(screen.getByText('Second PR comment')).toBeTruthy()
    })
  })

  it('ignores stale comment fetch results after the PR signature changes', async () => {
    const firstLoad = createDeferred<PrComment[]>()
    const secondLoad = createDeferred<PrComment[]>()
    vi.mocked(ipc.getPrComments)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const { rerender } = render(TaskPullRequestStatus, {
      props: { taskId: 'T-42', taskPrs: [createPullRequest({ updated_at: 1000, unaddressed_comment_count: 1 })] },
    })

    await waitFor(() => expect(ipc.getPrComments).toHaveBeenCalledTimes(1))
    await rerender({ taskId: 'T-42', taskPrs: [createPullRequest({ updated_at: 2000, unaddressed_comment_count: 1 })] })
    await waitFor(() => expect(ipc.getPrComments).toHaveBeenCalledTimes(2))

    secondLoad.resolve([createComment({ id: 2, body: 'Fresh feedback', addressed: 0 })])
    await waitFor(() => expect(screen.getByText('Fresh feedback')).toBeTruthy())

    firstLoad.resolve([createComment({ id: 1, body: 'Stale feedback', addressed: 0 })])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('Fresh feedback')).toBeTruthy()
    expect(screen.queryByText('Stale feedback')).toBeNull()
  })

  it('shows merge controls for one PR that is ready for user-initiated merge', () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ ci_status: 'success', mergeable: true, mergeable_state: 'clean' })],
      },
    })

    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
    expect(screen.getByText('Ready to Merge')).toBeTruthy()
  })

  it.each([
    ['pending CI', { ci_status: 'pending', mergeable: true, mergeable_state: 'clean' }],
    ['draft PR', { draft: true, ci_status: 'success', mergeable: true, mergeable_state: 'clean' }],
    ['unknown mergeability', { ci_status: 'success', mergeable: null, mergeable_state: 'unknown' }],
    ['null mergeability', { ci_status: 'success', mergeable: null, mergeable_state: null }],
  ] satisfies Array<[string, Partial<PullRequestInfo>]>)('does not show merge controls for %s', (_label, overrides) => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest(overrides)],
      },
    })

    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText('Ready to Merge')).toBeNull()
  })

  it('shows a queued badge without merge controls for queued PRs', () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ is_queued: true, ci_status: 'success', mergeable: true, mergeable_state: 'clean' })],
      },
    })

    expect(screen.getByText('Queued Pull Request')).toBeTruthy()
    expect(screen.getByText('Queued pull request — waiting for merge queue validation.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.queryByText('Ready to Merge')).toBeNull()
  })

  it('shows Enqueue controls for a PR that is ready for the merge queue', async () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc123', readiness_updated_at: 2000 })],
      },
    })

    expect(screen.getByText('Ready to Enqueue')).toBeTruthy()
    expect(screen.getByText('Ready to enqueue in the merge queue.')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Enqueue' }))

    expect(ipc.enqueuePullRequest).toHaveBeenCalledWith('owner', 'repo', 42)
    expect(ipc.mergePullRequest).not.toHaveBeenCalled()
  })

  it('does not show Enqueue controls for stale ready-to-enqueue readiness', () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [createPullRequest({ head_sha: 'new-head', mergeable: null, mergeable_state: 'unknown', merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'old-head', readiness_updated_at: 2000 })],
      },
    })

    expect(screen.queryByRole('button', { name: 'Enqueue' })).toBeNull()
    expect(screen.queryByText('Ready to Enqueue')).toBeNull()
  })

  it('shows persisted ready-to-enqueue and readiness-unknown details without direct merge controls', () => {
    render(TaskPullRequestStatus, {
      props: {
        taskId: 'T-42',
        taskPrs: [
          createPullRequest({ id: 1, merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc123', readiness_updated_at: 2000 }),
          createPullRequest({ id: 2, merge_readiness_status: 'readiness_unknown', merge_readiness_action: 'wait_for_github', readiness_source_head_sha: 'abc123', readiness_updated_at: 2000 }),
        ],
      },
    })

    expect(screen.getByText('Ready to Enqueue')).toBeTruthy()
    expect(screen.getByText('Ready to enqueue in the merge queue.')).toBeTruthy()
    expect(screen.getByText('Readiness Unknown')).toBeTruthy()
    expect(screen.getByText('Readiness unknown — waiting for GitHub to report definitive mergeability.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })
})
