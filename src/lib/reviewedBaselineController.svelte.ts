import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import { buildReviewedBaselineComparison } from './reviewedBaselineDiff'
import type { ReviewedFileSnapshot } from './taskReviewPaneState'
import type { PrFileDiff } from './types'

interface ReviewedBaselineComparison {
  file: PrFileDiff
  contents: FileContents
}

export interface ReviewedBaselineControllerOptions {
  getReviewFiles: () => PrFileDiff[]
  getSnapshots: () => Map<string, ReviewedFileSnapshot>
  getSelectedCommitSha: () => string | null
  getFileIdentity: (file: PrFileDiff) => string | null
  fetchCurrentContents: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>
}

export interface ReviewedBaselineController {
  readonly comparisonFilenames: Set<string>
  getReviewFile(file: PrFileDiff): PrFileDiff
  getVisibleFileReviewIdentity(file: PrFileDiff): string | null
  hasComparison(filename: string): boolean
  getComparisonContents(filename: string): FileContents | undefined
  mapFiles(files: PrFileDiff[]): PrFileDiff[]
  hasReviewedBaselineChange(file: PrFileDiff): boolean
  showChangesSinceReviewed(file: PrFileDiff): Promise<boolean>
  restoreFile(filename: string): void
  restoreAll(): void
}

export function createReviewedBaselineController(
  options: ReviewedBaselineControllerOptions,
): ReviewedBaselineController {
  let comparisonByFilename = $state<Map<string, ReviewedBaselineComparison>>(new Map())

  function reviewFileFor(file: PrFileDiff): PrFileDiff {
    return options.getReviewFiles().find((candidate) => candidate.filename === file.filename) ?? file
  }

  function getVisibleFileReviewIdentity(file: PrFileDiff): string | null {
    return options.getFileIdentity(reviewFileFor(file))
  }

  function hasComparison(filename: string): boolean {
    return comparisonByFilename.has(filename)
  }

  function getComparisonContents(filename: string): FileContents | undefined {
    return comparisonByFilename.get(filename)?.contents
  }

  function mapFiles(files: PrFileDiff[]): PrFileDiff[] {
    return files.map((file) => comparisonByFilename.get(file.filename)?.file ?? file)
  }

  function hasReviewedBaselineChange(file: PrFileDiff): boolean {
    if (options.getSelectedCommitSha() !== null) return false
    const reviewFile = reviewFileFor(file)
    const snapshot = options.getSnapshots().get(reviewFile.filename)
    const currentIdentity = options.getFileIdentity(reviewFile)
    return snapshot !== undefined && currentIdentity !== null && snapshot.identity !== currentIdentity
  }

  async function showChangesSinceReviewed(file: PrFileDiff): Promise<boolean> {
    const reviewFile = reviewFileFor(file)
    const result = await buildReviewedBaselineComparison({
      files: [reviewFile],
      snapshots: options.getSnapshots(),
      getFileIdentity: options.getFileIdentity,
      fetchCurrentContents: options.fetchCurrentContents,
    })
    const comparisonFile = result.files[0]
    const comparisonContents = result.contents.get(reviewFile.filename)
    if (comparisonFile === undefined || comparisonContents === undefined) return false

    comparisonByFilename = new Map(comparisonByFilename).set(reviewFile.filename, {
      file: comparisonFile,
      contents: comparisonContents,
    })
    return true
  }

  function restoreFile(filename: string): void {
    if (!comparisonByFilename.has(filename)) return
    const next = new Map(comparisonByFilename)
    next.delete(filename)
    comparisonByFilename = next
  }

  function restoreAll(): void {
    comparisonByFilename = new Map()
  }

  return {
    get comparisonFilenames() { return new Set(comparisonByFilename.keys()) },
    getReviewFile: reviewFileFor,
    getVisibleFileReviewIdentity,
    hasComparison,
    getComparisonContents,
    mapFiles,
    hasReviewedBaselineChange,
    showChangesSinceReviewed,
    restoreFile,
    restoreAll,
  }
}
