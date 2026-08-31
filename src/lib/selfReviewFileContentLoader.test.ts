import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createSelfReviewFileContentLoader,
  type SelfReviewFileContentContext,
} from './selfReviewFileContentLoader'
import type { PrFileDiff } from './types'
import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'

function contents(oldContent: string, newContent: string): FileContents {
  return { oldContent, newContent }
}

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
  it('exports the file content context contract', () => {
    expectTypeOf<SelfReviewFileContentContext>().toEqualTypeOf<{
      taskId: string
      selectedCommitSha: string | null
      includeCommitted: boolean
      includeUncommitted: boolean
    }>()
  })

  it('uses task-scoped content for single files, batches, and repository images', async () => {
    const getTaskFileContents = vi.fn()
      .mockResolvedValueOnce({
        oldContent: 'old',
        newContent: 'new',
        oldAvailability: { status: 'available', size: 3 },
        newAvailability: { status: 'available', size: 3 },
      })
      .mockResolvedValueOnce({
        oldContent: '',
        newContent: 'base64-diagram',
        oldAvailability: { status: 'missing' },
        newAvailability: { status: 'available', size: 14 },
      })
    const getTaskBatchFileContents = vi.fn().mockResolvedValue([{
      oldContent: 'batch old',
      newContent: '',
      oldAvailability: { status: 'available', size: 9 },
      newAvailability: { status: 'too-large', size: 26_214_401 },
    }])
    const getCommitFileContents = vi.fn()
    const getCommitBatchFileContents = vi.fn()
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: false,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents,
      getTaskBatchFileContents,
      getCommitFileContents,
      getCommitBatchFileContents,
    })

    await expect(loader.fetchCurrent(file)).resolves.toEqual({
      oldContent: 'old',
      newContent: 'new',
      oldAvailability: { status: 'available', size: 3 },
      newAvailability: { status: 'available', size: 3 },
    })
    await expect(loader.fetchCurrentBatch([file])).resolves.toEqual(new Map([
      [file.filename, {
        oldContent: 'batch old',
        newContent: '',
        oldAvailability: { status: 'available', size: 9 },
        newAvailability: { status: 'too-large', size: 26_214_401 },
      }],
    ]))
    await expect(loader.resolveRepositoryImage('docs/diagram.png')).resolves.toBe(
      'data:image/png;base64,base64-diagram',
    )

    expect(getTaskFileContents).toHaveBeenNthCalledWith(
      1,
      'task-1',
      file.filename,
      file.previous_filename,
      file.status,
      true,
      false,
    )
    expect(getTaskBatchFileContents).toHaveBeenCalledWith(
      'task-1',
      [{ path: file.filename, oldPath: file.previous_filename, status: file.status }],
      true,
      false,
    )
    expect(getTaskFileContents).toHaveBeenNthCalledWith(
      2,
      'task-1',
      'docs/diagram.png',
      null,
      'modified',
      true,
      false,
    )
    expect(getCommitFileContents).not.toHaveBeenCalled()
    expect(getCommitBatchFileContents).not.toHaveBeenCalled()
  })

  it('uses commit-scoped content for single files, batches, and repository images', async () => {
    const getCommitFileContents = vi.fn()
      .mockResolvedValueOnce(contents('before commit', 'after commit'))
      .mockResolvedValueOnce(contents('', 'base64-commit-diagram'))
    const getCommitBatchFileContents = vi.fn().mockResolvedValue([contents('batch before', 'batch after')])
    const getTaskFileContents = vi.fn()
    const getTaskBatchFileContents = vi.fn()
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: 'commit-sha',
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents,
      getTaskBatchFileContents,
      getCommitFileContents,
      getCommitBatchFileContents,
    })

    await expect(loader.fetchCurrent(file)).resolves.toEqual({
      oldContent: 'before commit',
      newContent: 'after commit',
    })
    await expect(loader.fetchCurrentBatch([file])).resolves.toEqual(new Map([
      [file.filename, { oldContent: 'batch before', newContent: 'batch after' }],
    ]))
    await expect(loader.resolveRepositoryImage('docs/diagram.png')).resolves.toBe(
      'data:image/png;base64,base64-commit-diagram',
    )

    expect(getCommitFileContents).toHaveBeenNthCalledWith(
      1,
      'task-1',
      'commit-sha',
      file.filename,
      file.previous_filename,
      file.status,
    )
    expect(getCommitBatchFileContents).toHaveBeenCalledWith(
      'task-1',
      'commit-sha',
      [{ path: file.filename, oldPath: file.previous_filename, status: file.status }],
    )
    expect(getCommitFileContents).toHaveBeenNthCalledWith(
      2,
      'task-1',
      'commit-sha',
      'docs/diagram.png',
      null,
      'modified',
    )
    expect(getTaskFileContents).not.toHaveBeenCalled()
    expect(getTaskBatchFileContents).not.toHaveBeenCalled()
  })

  it('merges reviewed comparisons with one batch request for current files', async () => {
    const comparedFile = { ...file, filename: 'src/compared.ts' }
    const currentFile = { ...file, filename: 'src/current.ts', previous_filename: 'src/old.ts' }
    const comparisonContents = { oldContent: 'reviewed', newContent: 'compared' }
    const getTaskBatchFileContents = vi.fn().mockResolvedValue([contents('before', 'current')])
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

  it('rejects an undersized task batch response with request and result counts', async () => {
    const secondFile = { ...file, filename: 'src/second-feature.ts' }
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: null,
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents: vi.fn(),
      getTaskBatchFileContents: vi.fn().mockResolvedValue([contents('before', 'after')]),
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn(),
    })

    await expect(loader.fetchCurrentBatch([file, secondFile])).rejects.toThrow(
      'getTaskBatchFileContents response count mismatch: requestCount=2, resultCount=1',
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

  it('rejects an undersized commit batch response with request and result counts', async () => {
    const secondFile = { ...file, filename: 'src/second-feature.ts' }
    const loader = createSelfReviewFileContentLoader({
      getContext: () => ({
        taskId: 'task-1',
        selectedCommitSha: 'commit-sha',
        includeCommitted: true,
        includeUncommitted: true,
      }),
      getComparisonContents: () => undefined,
      getTaskFileContents: vi.fn(),
      getTaskBatchFileContents: vi.fn(),
      getCommitFileContents: vi.fn(),
      getCommitBatchFileContents: vi.fn().mockResolvedValue([contents('before', 'after')]),
    })

    await expect(loader.fetchCurrentBatch([file, secondFile])).rejects.toThrow(
      'getCommitBatchFileContents response count mismatch: requestCount=2, resultCount=1',
    )
  })
})
