import { describe, expect, it } from 'vitest'
import { createReviewedBaselineController } from './reviewedBaselineController.svelte'
import type { SelfReviewContext } from './selfReviewFileContentLoader'
import type { PrFileDiff } from './types'

const currentFile: PrFileDiff = {
  sha: 'new-sha',
  filename: 'src/feature.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1,1 +1,1 @@\n-base\n+current',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

const contextChanges: Array<[
  name: string,
  change: (context: SelfReviewContext) => SelfReviewContext,
]> = [
  ['the task changes', (context) => ({ ...context, taskId: 'task-b' })],
  ['the diff scope changes', (context) => ({ ...context, includeCommitted: false })],
  ['a commit is selected', (context) => ({ ...context, selectedCommitSha: 'commit-sha' })],
]

describe('createReviewedBaselineController', () => {
  it('shows and restores changes since the Reviewed File Snapshot', async () => {
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getReviewContext: () => ({
        taskId: 'task-a',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: async () => new Map([
        [currentFile.filename, { oldContent: 'base\n', newContent: 'current\n' }],
      ]),
    })

    expect(controller.hasReviewedBaselineChange(currentFile)).toBe(true)
    await expect(controller.showChangesSinceReviewed(currentFile)).resolves.toBe(true)
    expect(controller.hasComparison(currentFile.filename)).toBe(true)
    expect(controller.getComparisonContents(currentFile.filename)).toEqual({
      oldContent: 'reviewed\n',
      newContent: 'current\n',
    })
    expect(controller.mapFiles([currentFile])[0]?.patch).toContain('-reviewed')
    expect(controller.mapFiles([currentFile])[0]?.patch).toContain('+current')
    expect(controller.comparisonFilenames).toEqual(new Set([currentFile.filename]))

    controller.restoreFile(currentFile.filename)
    expect(controller.hasComparison(currentFile.filename)).toBe(false)
    expect(controller.mapFiles([currentFile])).toEqual([currentFile])

    await controller.showChangesSinceReviewed(currentFile)
    controller.restoreAll()
    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it('uses the backing review file identity and suppresses comparisons for a selected commit', () => {
    const displayedFile = { ...currentFile, sha: 'comparison-sha' }
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getReviewContext: () => ({
        taskId: 'task-a',
        selectedCommitSha: 'commit-sha',
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: async () => new Map(),
    })

    expect(controller.getReviewFile(displayedFile)).toBe(currentFile)
    expect(controller.getVisibleFileReviewIdentity(displayedFile)).toBe('new-sha')
    expect(controller.hasReviewedBaselineChange(displayedFile)).toBe(false)
  })

  it('clears loaded comparisons when the review context is synchronized', async () => {
    let reviewContext: SelfReviewContext = {
      taskId: 'task-a',
      selectedCommitSha: null,
      includeCommitted: true,
      includeUncommitted: true,
    }
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getReviewContext: () => reviewContext,
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: async () => new Map([
        [currentFile.filename, { oldContent: 'base\n', newContent: 'current\n' }],
      ]),
    })

    await controller.showChangesSinceReviewed(currentFile)
    reviewContext = { ...reviewContext, includeUncommitted: false }
    controller.syncReviewContext()

    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it.each(contextChanges)('discards an in-flight comparison when %s', async (_name, changeContext) => {
    let reviewContext: SelfReviewContext = {
      taskId: 'task-a',
      selectedCommitSha: null,
      includeCommitted: true,
      includeUncommitted: true,
    }
    const contents = deferred<Map<string, { oldContent: string; newContent: string }>>()
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getReviewContext: () => reviewContext,
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: () => contents.promise,
    })

    const comparison = controller.showChangesSinceReviewed(currentFile)
    reviewContext = changeContext(reviewContext)
    contents.resolve(new Map([
      [currentFile.filename, { oldContent: 'base\n', newContent: 'current\n' }],
    ]))

    await expect(comparison).resolves.toBe(false)
    expect(controller.comparisonFilenames.size).toBe(0)
  })

  it('does not restore an in-flight comparison after restoring all comparisons', async () => {
    const contents = deferred<Map<string, { oldContent: string; newContent: string }>>()
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getReviewContext: () => ({
        taskId: 'task-a',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: () => contents.promise,
    })

    const comparison = controller.showChangesSinceReviewed(currentFile)
    controller.restoreAll()
    contents.resolve(new Map([
      [currentFile.filename, { oldContent: 'base\n', newContent: 'current\n' }],
    ]))

    await expect(comparison).resolves.toBe(false)
    expect(controller.comparisonFilenames.size).toBe(0)
  })
})
