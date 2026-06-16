import { render, screen, waitFor, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrComment, PullRequestInfo } from '../../lib/types'

vi.mock('../../lib/ipc', () => ({
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  linkPullRequest: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(ipc.getPrComments).mockResolvedValue([])
    vi.mocked(ipc.linkPullRequest).mockResolvedValue(createPullRequest())
    vi.mocked(ipc.openUrl).mockResolvedValue(undefined)
  })

  it('renders PR links and titles', () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest()] } })
    expect(screen.getByText('Test PR')).toBeTruthy()
    expect(screen.getByText('https://github.com/owner/repo/pull/42')).toBeTruthy()
  })

  it('opens PR links through the typed openUrl IPC wrapper', async () => {
    render(TaskPullRequestStatus, { props: { taskId: 'T-42', taskPrs: [createPullRequest()] } })

    await fireEvent.click(screen.getByText('https://github.com/owner/repo/pull/42'))

    expect(ipc.openUrl).toHaveBeenCalledWith('https://github.com/owner/repo/pull/42')
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
})
