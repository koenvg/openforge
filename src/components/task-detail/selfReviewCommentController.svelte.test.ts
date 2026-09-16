import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelfReviewTaskState } from '../../lib/taskScopedSelfReviewState'
import type { PrComment, PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'
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

const prComment: PrComment = {
  id: 1, pr_id: 1, author: 'alice', body: 'Original review', comment_type: 'review_comment',
  file_path: 'src/task.ts', line_number: 12, in_reply_to_id: null, addressed: 0, outdated: 0, created_at: 1000,
}

function feedbackFixture(inline: ReviewSubmissionComment[] = [], pr: PrComment[] = []) {
  let taskId = 'task-1'
  let state = $state<SelfReviewTaskState>({
    diffFiles: [], pendingInlineComments: inline, inlineCommentDrafts: new Map(),
  })
  let prComments = $state(pr)
  let controller!: ReturnType<typeof createSelfReviewCommentController>
  rootCleanups.push($effect.root(() => {
    controller = createSelfReviewCommentController({
      getTaskId: () => taskId, getState: () => state, getPrComments: () => prComments,
      getComparisonFilenames: () => new Set([hiddenComment.path]),
      setPendingComments: (_taskId, comments) => { state = { ...state, pendingInlineComments: comments } },
    })
  }))
  flushSync()
  return {
    controller,
    setInline(comments: ReviewSubmissionComment[]) { state = { ...state, pendingInlineComments: comments } },
    setPr(comments: PrComment[]) { flushSync(() => { prComments = comments }) },
    setTask(id: string) { taskId = id; controller.synchronize() },
  }
}

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

  it.each(['unchanged', 'edited', 'added'])('reconciles %s comparison-path feedback from a captured prompt', (change) => {
    const retained = change === 'unchanged' ? [] : [{
      ...hiddenComment,
      line: change === 'added' ? 8 : hiddenComment.line,
      body: change === 'added' ? 'New feedback after preview' : 'Edited feedback after preview',
    }]
    const { controller, setInline } = feedbackFixture([hiddenComment, visibleComment])
    const capture = controller.captureReviewFeedback()
    expect(capture.compilePrompt('address')).toContain(hiddenComment.body)
    expect(controller.pendingInlineComments).toEqual([hiddenComment, visibleComment])
    setInline(change === 'edited' ? [...retained, visibleComment] : [hiddenComment, visibleComment, ...retained])
    capture.reconcileAfterSend()
    expect(controller.pendingInlineComments).toEqual(retained)
    expect(controller.visiblePendingInlineComments).toEqual([])
  })

  it.each([
    {}, { body: 'Edited review' }, { author: 'bob' },
    { file_path: 'src/other.ts' }, { line_number: 99 },
  ])('deselects only unchanged captured GitHub feedback with changes %j', (changes) => {
    const { controller, setPr } = feedbackFixture([], [prComment])
    controller.commentSelection.selectAll()
    const capture = controller.captureReviewFeedback()
    const current = { ...prComment, ...changes }
    const added = { ...prComment, id: 2, body: 'Newly selected review' }
    setPr([current, added])
    controller.commentSelection.toggleSelected(added.id)

    expect(capture.compilePrompt('analyze')).toContain('Original review')
    expect(capture.compilePrompt('analyze')).not.toContain('Newly selected review')
    capture.reconcileAfterSend()

    expect(controller.commentSelection.selectedPrCommentIds).toEqual(
      new Set(Object.keys(changes).length ? [1, 2] : [2]),
    )
    expect(controller.commentSelection.addressedCount).toBe(0)
    expect(controller.commentSelection.unaddressedCount).toBe(2)
  })

  it.each([1, 2])('removes only the %i captured occurrences of identical inline feedback', (count) => {
    const { controller, setInline } = feedbackFixture(Array.from({ length: count }, () => ({ ...visibleComment })))
    const capture = controller.captureReviewFeedback()
    setInline(Array.from({ length: count + 1 }, () => ({ ...visibleComment })))
    capture.reconcileAfterSend()
    expect(controller.pendingInlineComments).toEqual([visibleComment])
    capture.reconcileAfterSend()
    expect(controller.pendingInlineComments).toEqual([visibleComment])
  })

  it.each([
    { body: 'Updated feedback' }, { path: 'src/other.ts' },
    { line: 99 }, { side: 'LEFT' as const },
  ])('preserves edited and new inline feedback with changes %j', (changes) => {
    const { controller, setInline } = feedbackFixture([visibleComment])
    const capture = controller.captureReviewFeedback()
    const edited = { ...visibleComment, ...changes }
    const added = { ...visibleComment, line: 8, body: 'New feedback' }
    setInline([edited, added])
    capture.reconcileAfterSend()
    expect(controller.pendingInlineComments).toEqual([edited, added])
  })

  it('keeps prompt snapshots when source comments are mutated', () => {
    const { controller } = feedbackFixture([visibleComment], [prComment])
    controller.commentSelection.selectAll()
    const capture = controller.captureReviewFeedback()
    controller.pendingInlineComments[0].body = 'Mutated inline feedback'
    controller.commentSelection.selectedPrComments[0].body = 'Mutated GitHub feedback'
    const prompt = capture.compilePrompt('analyze')
    expect(prompt).toContain('Visible comment')
    expect(prompt).toContain('Original review')
    expect(prompt).not.toContain('Mutated')
    capture.reconcileAfterSend()
    expect(controller.feedbackCount).toBe(2)
  })

  it('does not select removed or deselected GitHub feedback while reconciling', () => {
    const { controller, setPr } = feedbackFixture([], [prComment, { ...prComment, id: 2 }])
    controller.commentSelection.selectAll()
    const capture = controller.captureReviewFeedback()
    controller.commentSelection.toggleSelected(1)
    setPr([prComment])
    capture.reconcileAfterSend()
    expect(controller.commentSelection.selectedPrCommentIds.has(1)).toBe(false)
    expect(controller.commentSelection.selectedPrComments).toEqual([])
  })

  it('does not reconcile a capture against another task', () => {
    const { controller, setTask, setInline } = feedbackFixture([visibleComment], [prComment])
    controller.commentSelection.selectAll()
    const capture = controller.captureReviewFeedback()
    setTask('task-2')
    setInline([{ ...visibleComment }])
    controller.commentSelection.selectAll()
    capture.reconcileAfterSend()
    expect(controller.pendingInlineComments).toEqual([visibleComment])
    expect(controller.commentSelection.selectedPrCommentIds).toEqual(new Set([1]))
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
