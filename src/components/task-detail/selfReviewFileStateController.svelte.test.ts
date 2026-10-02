import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import {
  getCommitFileContents,
  getTaskBatchFileContents,
  getTaskFileContents,
} from '../../lib/ipc'
import { clearTaskReviewPaneState, markTaskReviewFileReviewed } from '../../lib/taskReviewPaneState'
import type { SelfReviewContext } from '../../lib/selfReviewFileContentLoader'
import type { PrFileDiff } from '../../lib/types'
import { createSelfReviewFileStateController } from './selfReviewFileStateController.svelte'

vi.mock('../../lib/ipc', () => ({
  getTaskFileContents: vi.fn(),
  getTaskBatchFileContents: vi.fn(),
  getCommitFileContents: vi.fn(),
  getCommitBatchFileContents: vi.fn(),
}))

const taskId = 'task-1'
const sourceFile: PrFileDiff = {
  sha: 'source-sha',
  filename: 'src/main.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n line\n+added',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}
const otherFile: PrFileDiff = { ...sourceFile, sha: 'other-sha', filename: 'src/other.ts' }
const currentContents: FileContents = { oldContent: 'base\n', newContent: 'current\n' }
const rootCleanups: Array<() => void> = []
const contextChanges: Array<[string, (context: SelfReviewContext) => SelfReviewContext]> = [
  ['the Task changes', (context) => ({ ...context, taskId: 'task-2' })],
  ['committed changes are excluded', (context) => ({ ...context, includeCommitted: false })],
  ['uncommitted changes are excluded', (context) => ({ ...context, includeUncommitted: false })],
  ['a commit is selected', (context) => ({ ...context, selectedCommitSha: 'commit-sha' })],
]

function reviewContext(): SelfReviewContext {
  return { taskId, selectedCommitSha: null, includeCommitted: true, includeUncommitted: true }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function createController(files = [sourceFile], getContext = reviewContext, isLoading = false) {
  let controller!: ReturnType<typeof createSelfReviewFileStateController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewFileStateController({
      getReviewFiles: () => files,
      getReviewContext: getContext,
      getIsDiffLoading: () => isLoading,
    })
  })
  rootCleanups.push(cleanup)
  return controller
}

function seedSnapshot() {
  markTaskReviewFileReviewed(taskId, { ...sourceFile, sha: 'reviewed-sha' }, { newContent: 'reviewed\n' })
}

beforeEach(() => {
  clearTaskReviewPaneState()
  vi.resetAllMocks()
  vi.mocked(getTaskFileContents).mockResolvedValue(currentContents)
  vi.mocked(getTaskBatchFileContents).mockResolvedValue([currentContents])
  vi.mocked(getCommitFileContents).mockResolvedValue(currentContents)
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
  vi.restoreAllMocks()
})

describe('createSelfReviewFileStateController', () => {
  it.each(contextChanges)('discards review acceptance when %s during the content read', async (_name, change) => {
    let context = reviewContext()
    const contents = deferred<FileContents>()
    vi.mocked(getTaskFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const acceptance = controller.toggleFileReviewed(sourceFile, true)
    context = change(context)
    controller.synchronize()
    contents.resolve(currentContents)
    await acceptance

    expect(controller.reviewedFileShas.size).toBe(0)
    context = reviewContext()
    controller.synchronize()
    expect(controller.reviewedFileShas.size).toBe(0)
    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(false)
  })

  it.each(contextChanges)('discards the identity-only fallback when %s during a failed content read', async (_name, change) => {
    let context = reviewContext()
    const contents = deferred<FileContents>()
    vi.mocked(getTaskFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const acceptance = controller.toggleFileReviewed(sourceFile, true)
    context = change(context)
    controller.synchronize()
    contents.reject(new Error('content unavailable'))
    await acceptance

    expect(controller.reviewedFileShas.size).toBe(0)
    context = reviewContext()
    controller.synchronize()
    expect(controller.reviewedFileShas.size).toBe(0)
    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(false)
  })

  it.each(['success', 'failure'])('discards a late acceptance %s before the new context is synchronized', async (outcome) => {
    let context = reviewContext()
    const contents = deferred<FileContents>()
    vi.mocked(getTaskFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const acceptance = controller.toggleFileReviewed(sourceFile, true)
    context = { ...context, taskId: 'task-2' }
    if (outcome === 'success') contents.resolve(currentContents)
    else contents.reject(new Error('content unavailable'))
    await acceptance
    controller.synchronize()
    expect(controller.reviewedFileShas.size).toBe(0)

    context = reviewContext()
    controller.synchronize()
    expect(controller.reviewedFileShas.size).toBe(0)
  })

  it.each(['success', 'failure'])('discards a late acceptance %s after switching away and back', async (outcome) => {
    let context = reviewContext()
    const contents = deferred<FileContents>()
    vi.mocked(getTaskFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const acceptance = controller.toggleFileReviewed(sourceFile, true)
    context = { ...context, taskId: 'task-2' }
    controller.synchronize()
    context = reviewContext()
    controller.synchronize()
    if (outcome === 'success') contents.resolve(currentContents)
    else contents.reject(new Error('content unavailable'))
    await acceptance

    expect(controller.reviewedFileShas.size).toBe(0)
    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(false)
  })

  it('marks a file reviewed without a snapshot when the current-context content read fails', async () => {
    seedSnapshot()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getTaskFileContents).mockRejectedValueOnce(new Error('content unavailable'))
    const controller = createController()
    controller.synchronize()

    await controller.toggleFileReviewed(sourceFile, true)
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe('source-sha')
    const remounted = createController([{ ...sourceFile, sha: 'next-sha' }])
    remounted.synchronize()
    expect(remounted.hasReviewedBaselineChange(sourceFile)).toBe(false)
  })

  it('prunes reviewed files that are no longer in the review', () => {
    markTaskReviewFileReviewed(taskId, sourceFile)
    const controller = createController([otherFile])
    controller.synchronize()
    expect(controller.reviewedFileShas.size).toBe(0)
  })

  it('keeps reviewed state while the diff is loading', () => {
    markTaskReviewFileReviewed(taskId, sourceFile)
    const controller = createController([otherFile], reviewContext, true)
    controller.synchronize()
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe('source-sha')
  })

  it('compares against the snapshot and restores the original diff and content', async () => {
    seedSnapshot()
    const controller = createController()
    controller.synchronize()

    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(true)
    await expect(controller.showChangesSinceReviewed(sourceFile)).resolves.toBe(true)
    const displayed = controller.visibleDiffFiles[0]!
    expect(displayed.patch).toContain('-reviewed')
    expect(displayed.patch).toContain('+current')
    expect(controller.getVisibleFileReviewIdentity(displayed)).toBe('source-sha')
    expect(controller.treeFiles).toEqual([sourceFile])
    expect(controller.comparisonFilenames).toEqual(new Set([sourceFile.filename]))
    await expect(controller.fetchFileContents(displayed)).resolves.toEqual({
      oldContent: 'reviewed\n', newContent: 'current\n',
    })
    await expect(controller.batchFetchFileContents([displayed, otherFile])).resolves.toEqual(new Map([
      [sourceFile.filename, { oldContent: 'reviewed\n', newContent: 'current\n' }],
      [otherFile.filename, currentContents],
    ]))

    controller.restoreFile(displayed)
    expect(controller.visibleDiffFiles).toEqual([sourceFile])
    await expect(controller.fetchFileContents(sourceFile)).resolves.toEqual(currentContents)
    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it('accepts the backing file and persists new content instead of the displayed comparison', async () => {
    seedSnapshot()
    const controller = createController()
    controller.synchronize()
    await controller.showChangesSinceReviewed(sourceFile)
    vi.mocked(getTaskFileContents).mockResolvedValueOnce({ oldContent: 'base\n', newContent: 'accepted\n' })

    await controller.toggleFileReviewed(controller.visibleDiffFiles[0]!, true)
    expect(controller.hasComparison(sourceFile.filename)).toBe(false)
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe('source-sha')

    const next = createController([{ ...sourceFile, sha: 'next-sha' }])
    next.synchronize()
    await next.showChangesSinceReviewed(sourceFile)
    await expect(next.fetchFileContents(sourceFile)).resolves.toEqual({
      oldContent: 'accepted\n', newContent: 'current\n',
    })
  })

  it('unmarks the file and removes its comparison and persisted snapshot', async () => {
    seedSnapshot()
    const controller = createController()
    controller.synchronize()
    await controller.showChangesSinceReviewed(sourceFile)

    await controller.toggleFileReviewed(controller.visibleDiffFiles[0]!, false)
    expect(controller.comparisonFilenames.size).toBe(0)
    expect(controller.reviewedFileShas.size).toBe(0)
    const remounted = createController()
    remounted.synchronize()
    expect(remounted.hasReviewedBaselineChange(sourceFile)).toBe(false)
  })

  it('uses the backing identity and commit content without offering a snapshot comparison', async () => {
    seedSnapshot()
    const context = { ...reviewContext(), selectedCommitSha: 'commit-sha' }
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    expect(controller.getVisibleFileReviewIdentity({ ...sourceFile, sha: 'comparison-sha' })).toBe('source-sha')
    expect(controller.hasReviewedBaselineChange(sourceFile)).toBe(false)
    await controller.toggleFileReviewed(sourceFile, true)
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe('source-sha')
    expect(getCommitFileContents).toHaveBeenCalledWith(taskId, 'commit-sha', sourceFile.filename, null, 'modified')
  })

  it.each(contextChanges)('clears a loaded comparison when %s', async (_name, change) => {
    seedSnapshot()
    let context = reviewContext()
    const controller = createController([sourceFile], () => context)
    controller.synchronize()
    await controller.showChangesSinceReviewed(sourceFile)

    context = change(context)
    controller.synchronize()
    expect(controller.comparisonFilenames.size).toBe(0)
    expect(controller.visibleDiffFiles).toEqual([sourceFile])
  })

  it.each(contextChanges)('discards an in-flight comparison when %s before synchronization', async (_name, change) => {
    seedSnapshot()
    let context = reviewContext()
    const contents = deferred<FileContents[]>()
    vi.mocked(getTaskBatchFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const comparison = controller.showChangesSinceReviewed(sourceFile)
    context = change(context)
    contents.resolve([currentContents])
    await expect(comparison).resolves.toBe(false)
    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it('does not restore an in-flight comparison after switching away and back', async () => {
    seedSnapshot()
    let context = reviewContext()
    const contents = deferred<FileContents[]>()
    vi.mocked(getTaskBatchFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const comparison = controller.showChangesSinceReviewed(sourceFile)
    context = { ...context, includeUncommitted: false }
    controller.synchronize()
    context = reviewContext()
    controller.synchronize()
    contents.resolve([currentContents])
    await expect(comparison).resolves.toBe(false)
    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it('reports a comparison failure only in its current review context', async () => {
    seedSnapshot()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getTaskBatchFileContents).mockRejectedValueOnce(new Error('content unavailable'))
    let context = reviewContext()
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    await expect(controller.showChangesSinceReviewed(sourceFile)).resolves.toBe(false)
    expect(controller.reviewedBaselineError).toContain("Couldn't compare src/main.ts")
    context = { ...context, taskId: 'task-2' }
    controller.synchronize()
    expect(controller.reviewedBaselineError).toBeNull()
  })

  it('discards a failed comparison from a previous review context', async () => {
    seedSnapshot()
    let context = reviewContext()
    const contents = deferred<FileContents[]>()
    vi.mocked(getTaskBatchFileContents).mockReturnValueOnce(contents.promise)
    const controller = createController([sourceFile], () => context)
    controller.synchronize()

    const comparison = controller.showChangesSinceReviewed(sourceFile)
    context = { ...context, taskId: 'task-2' }
    controller.synchronize()
    contents.reject(new Error('content unavailable'))
    await expect(comparison).resolves.toBe(false)
    expect(controller.reviewedBaselineError).toBeNull()
    expect(controller.comparisonFilenames.size).toBe(0)
  })
})
