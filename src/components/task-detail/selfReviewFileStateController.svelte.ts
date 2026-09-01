import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
import {
  getCommitBatchFileContents,
  getCommitFileContents,
  getTaskBatchFileContents,
  getTaskFileContents,
} from '../../lib/ipc'
import { createReviewedBaselineController } from '../../lib/reviewedBaselineController.svelte'
import { createSelfReviewFileContentLoader, type SelfReviewContext } from '../../lib/selfReviewFileContentLoader'
import {
  getTaskReviewFileIdentity,
  getTaskReviewReviewedFileShas,
  getTaskReviewReviewedFileSnapshots,
  markTaskReviewFileReviewed,
  pruneTaskReviewReviewedFiles,
  unmarkTaskReviewFileReviewed,
  type ReviewedFileSnapshot,
} from '../../lib/taskReviewPaneState'
import type { PrFileDiff } from '../../lib/types'

export interface SelfReviewFileStateControllerOptions {
  getTaskId: () => string
  getReviewFiles: () => PrFileDiff[]
  getReviewContext: () => SelfReviewContext
  getIsDiffLoading: () => boolean
}

export function createSelfReviewFileStateController(options: SelfReviewFileStateControllerOptions) {
  let includeNonApplicationFiles = $state(true)
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let reviewedFileSnapshots = $state<Map<string, ReviewedFileSnapshot>>(new Map())
  let reviewedBaselineError = $state<string | null>(null)
  let fileContentLoader: ReturnType<typeof createSelfReviewFileContentLoader>

  const reviewedBaseline = createReviewedBaselineController({
    getReviewFiles: options.getReviewFiles,
    getSnapshots: () => reviewedFileSnapshots,
    getReviewContext: options.getReviewContext,
    getFileIdentity: getTaskReviewFileIdentity,
    fetchCurrentContents: (files) => fileContentLoader.fetchCurrentBatch(files),
  })

  fileContentLoader = createSelfReviewFileContentLoader({
    getContext: options.getReviewContext,
    getComparisonContents: reviewedBaseline.getComparisonContents,
    getTaskFileContents: (...args) => getTaskFileContents(...args),
    getTaskBatchFileContents: (...args) => getTaskBatchFileContents(...args),
    getCommitFileContents: (...args) => getCommitFileContents(...args),
    getCommitBatchFileContents: (...args) => getCommitBatchFileContents(...args),
  })

  let nonApplicationFileCount = $derived(countNonApplicationFiles(options.getReviewFiles()))
  let treeFiles = $derived(filterApplicationFiles(options.getReviewFiles(), includeNonApplicationFiles))
  let comparisonMappedDiffFiles = $derived(reviewedBaseline.mapFiles(options.getReviewFiles()))
  let visibleDiffFiles = $derived(filterApplicationFiles(comparisonMappedDiffFiles, includeNonApplicationFiles))

  function syncReviewedFileState(): void {
    const taskId = options.getTaskId()
    reviewedFileShas = getTaskReviewReviewedFileShas(taskId)
    reviewedFileSnapshots = getTaskReviewReviewedFileSnapshots(taskId)
  }

  function synchronize(): void {
    reviewedBaseline.syncReviewContext()
    const reviewFiles = options.getReviewFiles()
    if (!options.getIsDiffLoading() && reviewFiles.length > 0) {
      pruneTaskReviewReviewedFiles(options.getTaskId(), reviewFiles)
    }
    syncReviewedFileState()
  }

  async function showChangesSinceReviewed(file: PrFileDiff): Promise<boolean> {
    reviewedBaselineError = null
    try {
      return await reviewedBaseline.showChangesSinceReviewed(file)
    } catch (error) {
      console.error(`[SelfReviewView] Failed to load Reviewed File Snapshot comparison for ${file.filename}:`, error)
      reviewedBaselineError = `Couldn't compare ${file.filename} with its Reviewed File Snapshot. Try the Since reviewed action again.`
      return false
    }
  }

  async function toggleFileReviewed(file: PrFileDiff, reviewed: boolean): Promise<void> {
    if (reviewed) {
      const reviewFile = reviewedBaseline.getReviewFile(file)
      try {
        const contents = await fileContentLoader.fetchCurrent(reviewFile)
        markTaskReviewFileReviewed(options.getTaskId(), reviewFile, { newContent: contents.newContent })
        reviewedBaseline.restoreFile(reviewFile.filename)
      } catch (error) {
        console.error(`Failed to snapshot reviewed file ${file.filename}:`, error)
        markTaskReviewFileReviewed(options.getTaskId(), reviewFile)
      }
    } else {
      unmarkTaskReviewFileReviewed(options.getTaskId(), file.filename)
      reviewedBaseline.restoreFile(file.filename)
    }
    syncReviewedFileState()
  }

  return {
    get includeNonApplicationFiles() { return includeNonApplicationFiles },
    get reviewedFileShas() { return reviewedFileShas },
    get reviewedBaselineError() { return reviewedBaselineError },
    get treeFiles() { return treeFiles },
    get visibleDiffFiles() { return visibleDiffFiles },
    get nonApplicationFileCount() { return nonApplicationFileCount },
    get comparisonFilenames() { return reviewedBaseline.comparisonFilenames },
    synchronize,
    setIncludeNonApplicationFiles: (value: boolean) => { includeNonApplicationFiles = value },
    toggleFileReviewed,
    getVisibleFileReviewIdentity: reviewedBaseline.getVisibleFileReviewIdentity,
    hasComparison: reviewedBaseline.hasComparison,
    hasReviewedBaselineChange: reviewedBaseline.hasReviewedBaselineChange,
    showChangesSinceReviewed,
    restoreFile: (file: PrFileDiff) => { reviewedBaseline.restoreFile(file.filename) },
    fetchFileContents: fileContentLoader.fetch,
    batchFetchFileContents: fileContentLoader.fetchBatch,
    fetchRepositoryFile: fileContentLoader.fetchRepositoryFile,
    resolveRepositoryImage: fileContentLoader.resolveRepositoryImage,
  }
}

export type SelfReviewFileStateController = ReturnType<typeof createSelfReviewFileStateController>
