import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelfReviewTaskState } from '../../lib/taskScopedSelfReviewState'
import type { PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewCommentController } from './selfReviewCommentController.svelte'

const { resolveGithubAsset } = vi.hoisted(() => ({
  resolveGithubAsset: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({ resolveGithubAsset }))

const hiddenComment: ReviewSubmissionComment = {
  path: 'src/hidden.ts',
  line: 2,
  body: 'Keep this comparison comment',
  side: 'RIGHT',
}
const visibleComment: ReviewSubmissionComment = {
  path: 'src/visible.ts',
  line: 4,
  body: 'Visible comment',
  side: 'RIGHT',
}
const rootCleanups: Array<() => void> = []

const linkedPr = {
  repo_owner: 'acme',
  repo_name: 'repo',
} as PullRequestInfo

const uploadUrl = 'https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3'

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
  resolveGithubAsset.mockReset()
})

describe('createSelfReviewCommentController', () => {
  it('hides comparison comments while preserving them when visible comments change', () => {
    let state = $state<SelfReviewTaskState>({
      diffFiles: [],
      pendingInlineComments: [hiddenComment, visibleComment],
      inlineCommentDrafts: new Map(),
    })
    let controller!: ReturnType<typeof createSelfReviewCommentController>
    const cleanup = $effect.root(() => {
      controller = createSelfReviewCommentController({
        getTaskId: () => 'task-1',
        getState: () => state,
        getPrComments: () => [],
        getComparisonFilenames: () => new Set([hiddenComment.path]),
        setPendingComments: (_taskId, comments) => {
          state = { ...state, pendingInlineComments: comments }
        },
      })
    })
    rootCleanups.push(cleanup)

    expect(controller.visiblePendingInlineComments).toEqual([visibleComment])

    const updatedVisibleComment = { ...visibleComment, body: 'Updated visible comment' }
    controller.handlePendingInlineCommentsChange([updatedVisibleComment])

    expect(controller.pendingInlineComments).toEqual([hiddenComment, updatedVisibleComment])
  })

  it('exchanges GitHub upload URLs through the sidecar', async () => {
    resolveGithubAsset.mockResolvedValue({ url: 'https://cdn.example/signed.png', kind: 'image' })
    let controller!: ReturnType<typeof createSelfReviewCommentController>
    const cleanup = $effect.root(() => {
      controller = createSelfReviewCommentController({
        getTaskId: () => 'task-1',
        getState: () => undefined,
        getPrComments: () => [],
        getLinkedPr: () => linkedPr,
        getComparisonFilenames: () => new Set(),
      })
    })
    rootCleanups.push(cleanup)

    await expect(controller.resolveRemoteMedia(uploadUrl)).resolves.toEqual({
      url: 'https://cdn.example/signed.png',
      kind: 'image',
    })
    expect(resolveGithubAsset).toHaveBeenCalledWith('acme', 'repo', uploadUrl)
  })

  it('does not ask the sidecar for non-attachment URLs or when no PR is linked', async () => {
    let linked: PullRequestInfo | null = null
    let controller!: ReturnType<typeof createSelfReviewCommentController>
    const cleanup = $effect.root(() => {
      controller = createSelfReviewCommentController({
        getTaskId: () => 'task-1',
        getState: () => undefined,
        getPrComments: () => [],
        getLinkedPr: () => linked,
        getComparisonFilenames: () => new Set(),
      })
    })
    rootCleanups.push(cleanup)

    await expect(controller.resolveRemoteMedia(uploadUrl)).resolves.toBeNull()

    linked = linkedPr
    await expect(controller.resolveRemoteMedia('https://github.com/acme/repo/pull/1')).resolves.toBeNull()
    expect(resolveGithubAsset).not.toHaveBeenCalled()
  })
})
