import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DiffViewer from './DiffViewer.svelte'
import type { PrFileDiff } from '../lib/types'
import { toGitDiffViewData } from '../lib/diffAdapter'




// ============================================================================
// Module Mocks
// ============================================================================

vi.mock('@git-diff-view/svelte', () => ({
  DiffView: vi.fn().mockReturnValue(null),
  DiffModeEnum: { Split: 0, Unified: 1 },
  SplitSide: { old: 1, new: 2 },
}))

vi.mock('../lib/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('../lib/diffAdapter', () => ({
  toGitDiffViewData: vi.fn().mockReturnValue({}),
  isTruncated: vi.fn().mockReturnValue(false),
  getTruncationStats: vi.fn().mockReturnValue(null),
}))

vi.mock('../lib/diffComments', () => ({
  buildExtendData: vi.fn().mockReturnValue({}),
}))

vi.mock('../lib/diffHighlighter', () => ({
  diffHighlighter: vi.fn(),
}))

// ============================================================================
// Toolbar Tests
// ============================================================================

describe('DiffViewer toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "No files to display" when files is empty', () => {
    render(DiffViewer, { props: { files: [] } })
    expect(screen.getByText('No files to display')).toBeTruthy()
  })

  it('toolbar always renders Split and Unified mode buttons', () => {
    render(DiffViewer, { props: { files: [] } })
    expect(screen.getByText('Split')).toBeTruthy()
    expect(screen.getByText('Unified')).toBeTruthy()
  })

  it('does not render a search button or search input', () => {
    render(DiffViewer, { props: { files: [] } })
    expect(screen.queryByTitle('Search (⌘F)')).toBeNull()
    expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
  })
})


// ============================================================================
// File Content Fetching Tests
// ============================================================================

const fileWithPatch: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/test.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const fileWithPatch2: PrFileDiff = {
  sha: 'def456',
  filename: 'src/other.ts',
  status: 'added',
  additions: 5,
  deletions: 0,
  changes: 5,
  patch: '@@ -0,0 +1,5 @@\n+line1\n+line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

describe('DiffViewer file content fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('batch fetch is called with files that have patches', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles.map((f: PrFileDiff) => f.filename)).toContain('src/test.ts')
  })

  it('batch fetch is preferred over per-file fetch when both are provided', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'content' }],
    ]))
    const perFileFn = vi.fn().mockResolvedValue({ oldContent: '', newContent: 'content' })

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
        fetchFileContents: perFileFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    expect(perFileFn).not.toHaveBeenCalled()
  })

  it('per-file fetch is used when no batch fetch is provided', async () => {
    const perFileFn = vi.fn().mockResolvedValue({ oldContent: '', newContent: 'content' })

    render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        fetchFileContents: perFileFn,
      },
    })

    await waitFor(() => {
      expect(perFileFn).toHaveBeenCalledTimes(1)
    })

    const [calledFile] = perFileFn.mock.calls[0] as [PrFileDiff]
    expect(calledFile.filename).toBe('src/test.ts')
  })

  it('files without patches are not passed to batch fetch', async () => {
    const fileNoPatch: PrFileDiff = {
      ...fileWithPatch,
      filename: 'src/nopatch.ts',
      patch: null,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map())

    render(DiffViewer, {
      props: {
        files: [fileNoPatch],
        batchFetchFileContents: batchFn,
      },
    })

    // Give the effect time to run
    await new Promise(resolve => setTimeout(resolve, 50))

    // batchFn should not be called because no files have patches
    expect(batchFn).not.toHaveBeenCalled()
  })

  it('re-fetches when includeUncommitted prop changes', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'content' }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
        includeUncommitted: false,
      },
    })

    // Wait for initial fetch
    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    // Change includeUncommitted — should trigger re-fetch
    await rerender({
      files: [fileWithPatch],
      batchFetchFileContents: batchFn,
      includeUncommitted: true,
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(2)
    })
  })

  it('batch fetch called once for multiple files in a single render', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'a' }],
      ['src/other.ts', { oldContent: '', newContent: 'b' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [fileWithPatch, fileWithPatch2],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    // Both files should be in the single batch call
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles).toHaveLength(2)
    const filenames = calledFiles.map((f: PrFileDiff) => f.filename)
    expect(filenames).toContain('src/test.ts')
    expect(filenames).toContain('src/other.ts')
  })
})

// ============================================================================

// ============================================================================
// DiffViewData Memoization Tests
// ============================================================================

describe('DiffViewData memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call toGitDiffViewData again on rerender when files and contents are unchanged', async () => {
    const mockToGitDiffViewData = vi.mocked(toGitDiffViewData)

    const { rerender } = render(DiffViewer, {
      props: { files: [fileWithPatch] },
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const initialCallCount = mockToGitDiffViewData.mock.calls.length

    await rerender({ files: [fileWithPatch] })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockToGitDiffViewData.mock.calls.length).toBe(initialCallCount)
  })

  it('memoization prevents unnecessary toGitDiffViewData calls on rerender with same files', async () => {
    const mockToGitDiffViewData = vi.mocked(toGitDiffViewData)
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [fileWithPatch],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })
    
    const callsAfterFirstRender = mockToGitDiffViewData.mock.calls.length

    // Rerender with same files and same batch function
    await rerender({
      files: [fileWithPatch],
      batchFetchFileContents: batchFn,
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    // toGitDiffViewData should not be called again because:
    // 1. Files array is the same
    // 2. fileContentsMap hasn't changed (batch fetch was already done)
    // 3. Cache should return the same DiffViewData object
    expect(mockToGitDiffViewData.mock.calls.length).toBe(callsAfterFirstRender)
  })
})
