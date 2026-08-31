import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTaskReviewPaneState,
  getTaskReviewReviewedFileShas,
  markTaskReviewFileReviewed,
} from '../../lib/taskReviewPaneState'
import type { SelfReviewContext } from '../../lib/selfReviewFileContentLoader'
import type { PrFileDiff } from '../../lib/types'
import { createSelfReviewFileStateController } from './selfReviewFileStateController.svelte'

vi.mock('../../lib/ipc', () => ({
  getTaskFileContents: vi.fn().mockResolvedValue({ oldContent: 'base\n', newContent: 'current\n' }),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([{ oldContent: 'base\n', newContent: 'current\n' }]),
  getCommitFileContents: vi.fn().mockResolvedValue({ oldContent: 'base\n', newContent: 'current\n' }),
  getCommitBatchFileContents: vi.fn().mockResolvedValue([{ oldContent: 'base\n', newContent: 'current\n' }]),
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
const rootCleanups: Array<() => void> = []

function createController(files = [sourceFile]) {
  let controller!: ReturnType<typeof createSelfReviewFileStateController>
  const context: SelfReviewContext = {
    taskId,
    selectedCommitSha: null,
    includeCommitted: true,
    includeUncommitted: true,
  }
  const cleanup = $effect.root(() => {
    controller = createSelfReviewFileStateController({
      getTaskId: () => taskId,
      getReviewFiles: () => files,
      getReviewContext: () => context,
      getIsDiffLoading: () => false,
    })
  })
  rootCleanups.push(cleanup)
  return controller
}

beforeEach(() => {
  clearTaskReviewPaneState()
  vi.clearAllMocks()
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewFileStateController', () => {
  it('prunes reviewed files that are no longer in the review', () => {
    markTaskReviewFileReviewed(taskId, sourceFile)
    const controller = createController([otherFile])

    controller.synchronize()

    expect(controller.reviewedFileShas.size).toBe(0)
    expect(getTaskReviewReviewedFileShas(taskId).size).toBe(0)
  })

  it('loads a Reviewed File Snapshot comparison and replaces it when reviewed again', async () => {
    markTaskReviewFileReviewed(
      taskId,
      { ...sourceFile, sha: 'reviewed-sha' },
      { newContent: 'reviewed\n' },
    )
    const controller = createController()
    controller.synchronize()

    await expect(controller.showChangesSinceReviewed(sourceFile)).resolves.toBe(true)
    expect(controller.hasComparison(sourceFile.filename)).toBe(true)

    await controller.toggleFileReviewed(sourceFile, true)

    expect(controller.hasComparison(sourceFile.filename)).toBe(false)
    expect(controller.reviewedFileShas.get(sourceFile.filename)).toBe(sourceFile.sha)
  })
})
