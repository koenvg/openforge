import { countNonApplicationFiles, filterApplicationFiles } from '@openforge-app/pr-review-ui/applicationFiles'
import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import {
  getCommitBatchFileContents,
  getCommitFileContents,
  getTaskBatchFileContents,
  getTaskFileContents,
} from '../../lib/ipc'
import { buildReviewedBaselineComparison } from '../../lib/reviewedBaselineDiff'
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
  getReviewFiles: () => PrFileDiff[]
  getReviewContext: () => SelfReviewContext
  getIsDiffLoading: () => boolean
}

interface ReviewedBaselineComparison {
  file: PrFileDiff
  contents: FileContents
}

function getReviewContextIdentity(context: SelfReviewContext): string {
  return JSON.stringify([
    context.taskId,
    context.selectedCommitSha,
    context.includeCommitted,
    context.includeUncommitted,
  ])
}

export function createSelfReviewFileStateController(options: SelfReviewFileStateControllerOptions) {
  let includeNonApplicationFiles = $state(true)
  let reviewedFileShas = $state<Map<string, string>>(new Map())
  let reviewedFileSnapshots = $state<Map<string, ReviewedFileSnapshot>>(new Map())
  let reviewedBaselineError = $state<string | null>(null)
  let comparisonByFilename = $state<Map<string, ReviewedBaselineComparison>>(new Map())
  let reviewContextIdentity = getReviewContextIdentity(options.getReviewContext())
  let contextGeneration = 0

  const fileContentLoader = createSelfReviewFileContentLoader({
    getContext: options.getReviewContext,
    getComparisonContents: (filename) => comparisonByFilename.get(filename)?.contents,
    getTaskFileContents: (...args) => getTaskFileContents(...args),
    getTaskBatchFileContents: (...args) => getTaskBatchFileContents(...args),
    getCommitFileContents: (...args) => getCommitFileContents(...args),
    getCommitBatchFileContents: (...args) => getCommitBatchFileContents(...args),
  })

  let nonApplicationFileCount = $derived(countNonApplicationFiles(options.getReviewFiles()))
  let treeFiles = $derived(filterApplicationFiles(options.getReviewFiles(), includeNonApplicationFiles))
  let comparisonMappedDiffFiles = $derived(options.getReviewFiles().map(
    (file) => comparisonByFilename.get(file.filename)?.file ?? file,
  ))
  let visibleDiffFiles = $derived(filterApplicationFiles(comparisonMappedDiffFiles, includeNonApplicationFiles))

  function syncReviewContext(): void {
    const nextIdentity = getReviewContextIdentity(options.getReviewContext())
    if (nextIdentity === reviewContextIdentity) return
    reviewContextIdentity = nextIdentity
    contextGeneration += 1
    comparisonByFilename = new Map()
    reviewedBaselineError = null
  }

  function isCurrentRequest(identity: string, generation: number): boolean {
    return identity === getReviewContextIdentity(options.getReviewContext())
      && generation === contextGeneration
  }

  function syncReviewedFileState(): void {
    const { taskId } = options.getReviewContext()
    reviewedFileShas = getTaskReviewReviewedFileShas(taskId)
    reviewedFileSnapshots = getTaskReviewReviewedFileSnapshots(taskId)
  }

  function synchronize(): void {
    syncReviewContext()
    const reviewFiles = options.getReviewFiles()
    if (!options.getIsDiffLoading() && reviewFiles.length > 0) {
      pruneTaskReviewReviewedFiles(options.getReviewContext().taskId, reviewFiles)
    }
    syncReviewedFileState()
  }

  function getReviewFile(file: PrFileDiff): PrFileDiff {
    return options.getReviewFiles().find((candidate) => candidate.filename === file.filename) ?? file
  }

  function getVisibleFileReviewIdentity(file: PrFileDiff): string | null {
    return getTaskReviewFileIdentity(getReviewFile(file))
  }

  function hasComparison(filename: string): boolean {
    return comparisonByFilename.has(filename)
  }

  function hasReviewedBaselineChange(file: PrFileDiff): boolean {
    if (options.getReviewContext().selectedCommitSha !== null) return false
    const reviewFile = getReviewFile(file)
    const snapshot = reviewedFileSnapshots.get(reviewFile.filename)
    const currentIdentity = getTaskReviewFileIdentity(reviewFile)
    return snapshot !== undefined && currentIdentity !== null && snapshot.identity !== currentIdentity
  }

  function restoreFile(file: PrFileDiff): void {
    if (!comparisonByFilename.has(file.filename)) return
    const next = new Map(comparisonByFilename)
    next.delete(file.filename)
    comparisonByFilename = next
  }

  async function showChangesSinceReviewed(file: PrFileDiff): Promise<boolean> {
    syncReviewContext()
    const requestContextIdentity = reviewContextIdentity
    const requestGeneration = contextGeneration
    const reviewFile = getReviewFile(file)
    reviewedBaselineError = null
    try {
      const result = await buildReviewedBaselineComparison({
        files: [reviewFile],
        snapshots: reviewedFileSnapshots,
        getFileIdentity: getTaskReviewFileIdentity,
        fetchCurrentContents: fileContentLoader.fetchCurrentBatch,
      })
      if (!isCurrentRequest(requestContextIdentity, requestGeneration)) return false
      const comparisonFile = result.files[0]
      const comparisonContents = result.contents.get(reviewFile.filename)
      if (comparisonFile === undefined || comparisonContents === undefined) return false
      comparisonByFilename = new Map(comparisonByFilename).set(reviewFile.filename, {
        file: comparisonFile,
        contents: comparisonContents,
      })
      return true
    } catch (error) {
      if (!isCurrentRequest(requestContextIdentity, requestGeneration)) return false
      console.error(`[SelfReviewView] Failed to load Reviewed File Snapshot comparison for ${file.filename}:`, error)
      reviewedBaselineError = `Couldn't compare ${file.filename} with its Reviewed File Snapshot. Try the Since reviewed action again.`
      return false
    }
  }

  async function toggleFileReviewed(file: PrFileDiff, reviewed: boolean): Promise<void> {
    syncReviewContext()
    const { taskId } = options.getReviewContext()
    const requestContextIdentity = reviewContextIdentity
    const requestGeneration = contextGeneration
    if (reviewed) {
      const reviewFile = getReviewFile(file)
      try {
        const contents = await fileContentLoader.fetchCurrent(reviewFile)
        if (!isCurrentRequest(requestContextIdentity, requestGeneration)) return
        markTaskReviewFileReviewed(taskId, reviewFile, { newContent: contents.newContent })
        restoreFile(reviewFile)
      } catch (error) {
        if (!isCurrentRequest(requestContextIdentity, requestGeneration)) return
        console.error(`Failed to snapshot reviewed file ${file.filename}:`, error)
        markTaskReviewFileReviewed(taskId, reviewFile)
      }
    } else {
      unmarkTaskReviewFileReviewed(taskId, file.filename)
      restoreFile(file)
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
    get comparisonFilenames() { return new Set(comparisonByFilename.keys()) },
    synchronize,
    setIncludeNonApplicationFiles: (value: boolean) => { includeNonApplicationFiles = value },
    toggleFileReviewed,
    getVisibleFileReviewIdentity,
    hasComparison,
    hasReviewedBaselineChange,
    showChangesSinceReviewed,
    restoreFile,
    fetchFileContents: fileContentLoader.fetch,
    batchFetchFileContents: fileContentLoader.fetchBatch,
    fetchRepositoryFile: fileContentLoader.fetchRepositoryFile,
    resolveRepositoryImage: fileContentLoader.resolveRepositoryImage,
  }
}

export type SelfReviewFileStateController = ReturnType<typeof createSelfReviewFileStateController>
