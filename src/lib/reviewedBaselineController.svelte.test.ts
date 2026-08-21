import { describe, expect, it } from 'vitest'
import { createReviewedBaselineController } from './reviewedBaselineController.svelte'
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

describe('createReviewedBaselineController', () => {
  it('shows and restores changes since the Reviewed File Snapshot', async () => {
    const controller = createReviewedBaselineController({
      getReviewFiles: () => [currentFile],
      getSnapshots: () => new Map([
        [currentFile.filename, { identity: 'old-sha', newContent: 'reviewed\n' }],
      ]),
      getSelectedCommitSha: () => null,
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
      getSelectedCommitSha: () => 'commit-sha',
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: async () => new Map(),
    })

    expect(controller.getReviewFile(displayedFile)).toBe(currentFile)
    expect(controller.getVisibleFileReviewIdentity(displayedFile)).toBe('new-sha')
    expect(controller.hasReviewedBaselineChange(displayedFile)).toBe(false)
  })
})
