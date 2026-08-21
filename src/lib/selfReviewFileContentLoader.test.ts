import { describe, expect, it, vi } from 'vitest'
import { createSelfReviewFileContentLoader } from './selfReviewFileContentLoader'
import type { PrFileDiff } from './types'

const file: PrFileDiff = {
  sha: 'current-sha',
  filename: 'src/feature.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1,1 +1,1 @@\n-old\n+new',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

describe('createSelfReviewFileContentLoader', () => {
  it('loads current task file contents for the active review scope', async () => {
    const getTaskFileContents = vi.fn().mockResolvedValue(['old', 'new'])
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: false,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents,
      getTaskBatchFileContents: vi.fn(),
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.fetchCurrent(file)).resolves.toEqual({ oldContent: 'old', newContent: 'new' })
    expect(getTaskFileContents).toHaveBeenCalledWith(
      'task-1',
      file.filename,
      file.previous_filename,
      file.status,
      true,
      false,
    )
  })

  it('loads file contents from a selected commit', async () => {
    const getCommitFileContents = vi.fn().mockResolvedValue(['before commit', 'after commit'])
    const getTaskFileContents = vi.fn()
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: 'commit-sha',
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents,
      getTaskBatchFileContents: vi.fn(),
      getCommitFileContents,
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.fetchCurrent(file)).resolves.toEqual({
      oldContent: 'before commit',
      newContent: 'after commit',
    })
    expect(getCommitFileContents).toHaveBeenCalledWith(
      'task-1',
      'commit-sha',
      file.filename,
      file.previous_filename,
      file.status,
    )
    expect(getTaskFileContents).not.toHaveBeenCalled()
  })

  it('merges reviewed comparisons with one batch request for current files', async () => {
    const comparedFile = { ...file, filename: 'src/compared.ts' }
    const currentFile = { ...file, filename: 'src/current.ts', previous_filename: 'src/old.ts' }
    const comparisonContents = { oldContent: 'reviewed', newContent: 'compared' }
    const getTaskBatchFileContents = vi.fn().mockResolvedValue([['before', 'current']])
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: false,
        includeUncommitted: true,
      }),
      getComparisonContents: (filename) => filename === comparedFile.filename ? comparisonContents : undefined,
      getTaskFileContents: vi.fn(),
      getTaskBatchFileContents,
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.fetchBatch([comparedFile, currentFile])).resolves.toEqual(new Map([
      [comparedFile.filename, comparisonContents],
      [currentFile.filename, { oldContent: 'before', newContent: 'current' }],
    ]))
    expect(getTaskBatchFileContents).toHaveBeenCalledWith(
      'task-1',
      [{ path: currentFile.filename, oldPath: currentFile.previous_filename, status: currentFile.status }],
      false,
      true,
    )
  })

  it('returns reviewed comparison contents without loading the current file again', async () => {
    const comparisonContents = { oldContent: 'reviewed', newContent: 'current' }
    const getTaskFileContents = vi.fn()
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => comparisonContents,
      getTaskFileContents,
      getTaskBatchFileContents: vi.fn(),
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.fetch(file)).resolves.toBe(comparisonContents)
    expect(getTaskFileContents).not.toHaveBeenCalled()
  })

  it('loads current batches from the selected commit', async () => {
    const getCommitBatchFileContents = vi.fn().mockResolvedValue([['before', 'after']])
    const getTaskBatchFileContents = vi.fn()
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: 'commit-sha',
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents: vi.fn(),
      getTaskBatchFileContents,
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents,
    })

    await expect(loader.fetchCurrentBatch([file])).resolves.toEqual(new Map([
      [file.filename, { oldContent: 'before', newContent: 'after' }],
    ]))
    expect(getCommitBatchFileContents).toHaveBeenCalledWith(
      'task-1',
      'commit-sha',
      [{ path: file.filename, oldPath: file.previous_filename, status: file.status }],
    )
    expect(getTaskBatchFileContents).not.toHaveBeenCalled()
  })

  it('loads repository images through the active file-content source', async () => {
    const getTaskFileContents = vi.fn().mockResolvedValue(['', 'base64-diagram'])
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents,
      getTaskBatchFileContents: vi.fn(),
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.resolveRepositoryImage('docs/diagram.png')).resolves.toBe(
      'data:image/png;base64,base64-diagram',
    )
    expect(getTaskFileContents).toHaveBeenCalledWith(
      'task-1',
      'docs/diagram.png',
      null,
      'modified',
      true,
      true,
    )
  })
})
