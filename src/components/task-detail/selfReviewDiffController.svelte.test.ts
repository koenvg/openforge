import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPullRequest } from '../../App.test-fixtures/github'
import { getConfig, getPrComments } from '../../lib/ipc'
import { clearTaskReviewPaneState, getTaskReviewPaneState } from '../../lib/taskReviewPaneState'
import type { PrComment, PullRequestInfo } from '../../lib/types'
import { createSelfReviewDiffController } from './selfReviewDiffController.svelte'

vi.mock('../../lib/ipc', () => ({
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskCommits: vi.fn().mockResolvedValue([]),
  getCommitDiff: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
}))

const taskId = 'task-1'
const rootCleanups: Array<() => void> = []

const openPr = createPullRequest({ id: 11, pr_number: 11, ticket_id: taskId, updated_at: 1_700_000_200 })

function makeComment(id: number, prId = openPr.id): PrComment {
  return {
    id,
    pr_id: prId,
    author: 'reviewer',
    body: `Comment ${id}`,
    comment_type: 'review_comment',
    file_path: 'src/main.rs',
    line_number: 12,
    in_reply_to_id: null,
    addressed: 0,
    outdated: 0,
    created_at: 1_700_000_300 + id,
  }
}

function createController(initialPullRequests: PullRequestInfo[] = []) {
  let pullRequests = $state(initialPullRequests)
  let controller!: ReturnType<typeof createSelfReviewDiffController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewDiffController({
      getTaskId: () => taskId,
      getPullRequests: () => pullRequests,
    })
  })
  rootCleanups.push(() => {
    controller.dispose()
    cleanup()
  })
  return {
    controller,
    setPullRequests(next: PullRequestInfo[]) {
      pullRequests = next
      flushSync()
    },
  }
}

beforeEach(() => {
  clearTaskReviewPaneState()
  vi.clearAllMocks()
  vi.mocked(getPrComments).mockResolvedValue([])
  vi.mocked(getConfig).mockResolvedValue(null)
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewDiffController', () => {
  it('owns diff scope locking and refreshes the selected scope', async () => {
    const { getTaskDiff } = await import('../../lib/ipc')
    const { controller } = createController()

    await controller.setIncludeCommitted(false)

    expect(getTaskDiff).toHaveBeenLastCalledWith(taskId, false, true)
    expect(controller.committedLocked).toBe(false)
    expect(controller.uncommittedLocked).toBe(true)
  })

  it('persists commit selection while loading that commit diff', async () => {
    const { getCommitDiff } = await import('../../lib/ipc')
    const { controller } = createController()

    await controller.selectCommit('commit-sha')

    expect(getCommitDiff).toHaveBeenCalledWith(taskId, 'commit-sha')
    expect(getTaskReviewPaneState(taskId).selectedCommitSha).toBe('commit-sha')
  })

  it('links the newest open pull request of the task', () => {
    const olderOpenPr = { ...openPr, id: 10, updated_at: openPr.updated_at - 100 }
    const newerClosedPr = { ...openPr, id: 12, state: 'closed', updated_at: openPr.updated_at + 100 }
    const { controller } = createController([olderOpenPr, openPr, newerClosedPr])

    expect(controller.linkedPr?.id).toBe(openPr.id)
  })

  it('withholds pull request comments until the GitHub identity is known', async () => {
    let resolveIdentity!: (username: string | null) => void
    vi.mocked(getConfig).mockReturnValue(new Promise((resolve) => { resolveIdentity = resolve }))
    vi.mocked(getPrComments).mockResolvedValue([makeComment(1)])
    const { controller } = createController([openPr])

    const load = controller.load()
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledWith('github_username'))
    expect(controller.prComments).toEqual([])

    resolveIdentity('author')
    await load

    await vi.waitFor(() => expect(controller.prComments).toEqual([makeComment(1)]))
    expect(controller.githubUsername).toBe('author')
  })

  it('loads comments for a pull request linked after the review opened', async () => {
    vi.mocked(getPrComments).mockResolvedValue([makeComment(1)])
    const { controller, setPullRequests } = createController()
    await controller.load()
    expect(controller.prComments).toEqual([])

    setPullRequests([openPr])

    await vi.waitFor(() => expect(controller.prComments).toEqual([makeComment(1)]))
  })

  it('reloads comments when the linked pull request reports new comments', async () => {
    vi.mocked(getPrComments).mockResolvedValue([makeComment(1)])
    const { controller, setPullRequests } = createController([openPr])
    await controller.load()
    await vi.waitFor(() => expect(controller.prComments).toEqual([makeComment(1)]))

    vi.mocked(getPrComments).mockResolvedValue([makeComment(1), makeComment(2)])
    setPullRequests([{ ...openPr, unaddressed_comment_count: 2 }])

    await vi.waitFor(() => expect(controller.prComments).toEqual([makeComment(1), makeComment(2)]))
  })

  it('reloads comments on refresh', async () => {
    vi.mocked(getPrComments).mockResolvedValue([makeComment(1)])
    const { controller } = createController([openPr])
    await controller.load()
    await vi.waitFor(() => expect(controller.prComments).toEqual([makeComment(1)]))

    vi.mocked(getPrComments).mockResolvedValue([makeComment(2)])
    await controller.refresh()

    expect(controller.prComments).toEqual([makeComment(2)])
  })
})
