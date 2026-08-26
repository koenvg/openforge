import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '../../../../lib/types'
import { requireElement } from '../../../../test-utils/dom'
import './DiffViewer.test-harness'
import { toGitDiffViewData } from '@openforge-app/pr-review-ui/diffAdapter'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch, addedFileWithPatch } from './DiffViewer.test-fixtures'

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
        files: [modifiedFileWithPatch],
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
        files: [modifiedFileWithPatch],
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
        files: [modifiedFileWithPatch],
        fetchFileContents: perFileFn,
      },
    })

    await waitFor(() => {
      expect(perFileFn).toHaveBeenCalledTimes(1)
    })

    const [calledFile] = perFileFn.mock.calls[0] as [PrFileDiff]
    expect(calledFile.filename).toBe('src/test.ts')
  })

  it('non-image files without patches are not passed to batch fetch', async () => {
    const fileNoPatch: PrFileDiff = {
      ...modifiedFileWithPatch,
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

    // batchFn should not be called because no files have patches or image previews
    expect(batchFn).not.toHaveBeenCalled()
  })

  it('shows a terminal state for a binary file without an image preview', () => {
    const binaryFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'assets/archive.zip',
      status: 'binary',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
    }

    render(DiffViewer, { props: { files: [binaryFile] } })

    expect(screen.getByText('Binary file changes cannot be displayed.')).toBeTruthy()
    expect(screen.queryByText('Processing diff…')).toBeNull()
  })

  it('shows a terminal state when a text diff is unavailable', () => {
    const unavailableFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'src/generated.ts',
      status: 'modified',
      patch: null,
    }

    render(DiffViewer, { props: { files: [unavailableFile] } })

    expect(screen.getByText('Diff unavailable for this file.')).toBeTruthy()
    expect(screen.queryByText('Processing diff…')).toBeNull()
  })

  it('keeps an unavailable Markdown diff terminal when Rich view is selected', async () => {
    const unavailableFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'docs/generated.md',
      status: 'modified',
      patch: null,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map())

    render(DiffViewer, {
      props: {
        files: [unavailableFile],
        batchFetchFileContents: batchFn,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for docs/generated.md' }))

    expect(screen.getByText('Diff unavailable for this file.')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading rich diff for docs/generated.md' })).toBeNull()
    expect(batchFn).not.toHaveBeenCalled()
  })

  it('keeps the worker-backed loading state for files with text patches', async () => {
    const { createDiffWorker } = await import('@openforge-app/pr-review-ui/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => undefined,
      processing: true,
    })

    render(DiffViewer, { props: { files: [modifiedFileWithPatch] } })

    expect(screen.getByText('Processing diff…')).toBeTruthy()
    expect(screen.queryByText('Diff unavailable for this file.')).toBeNull()
  })

  it('shows a terminal state for a pure rename without a text patch', () => {
    const renamedFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'src/new-name.ts',
      previous_filename: 'src/old-name.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
    }

    render(DiffViewer, { props: { files: [renamedFile] } })

    expect(screen.getByText('File renamed without content changes.')).toBeTruthy()
    expect(screen.queryByText('Processing diff…')).toBeNull()
  })

  it('keeps a pure Markdown rename terminal when Rich view is selected', async () => {
    const renamedFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'docs/new-name.md',
      previous_filename: 'docs/old-name.md',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map())

    render(DiffViewer, {
      props: {
        files: [renamedFile],
        batchFetchFileContents: batchFn,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for docs/new-name.md' }))

    expect(screen.getByText('File renamed without content changes.')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading rich diff for docs/new-name.md' })).toBeNull()
    expect(batchFn).not.toHaveBeenCalled()
  })

  it('renders image previews for image files without text patches', async () => {
    const imageFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'assets/logo.png',
      status: 'binary',
      patch: null,
      additions: 0,
      deletions: 0,
      changes: 0,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['assets/logo.png', { oldContent: '', newContent: 'base64-image' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [imageFile],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'assets/logo.png new preview' })).toBeTruthy()
    })

    expect(batchFn).toHaveBeenCalledTimes(1)
    const image = requireElement(screen.getByRole('img', { name: 'assets/logo.png new preview' }), HTMLImageElement)
    expect(image.getAttribute('src')).toBe('data:image/png;base64,base64-image')
    expect(screen.queryByText('Processing diff…')).toBeNull()
  })

  it('reports the selected image and its before/after gallery when a preview is opened', async () => {
    const imageFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'assets/logo.png',
      status: 'binary',
      patch: null,
      additions: 0,
      deletions: 0,
      changes: 0,
    }
    const onOpenImage = vi.fn()

    render(DiffViewer, {
      props: {
        files: [imageFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([
          ['assets/logo.png', { oldContent: 'before-image', newContent: 'after-image' }],
        ])),
        onOpenImage,
      },
    })

    const afterPreview = await screen.findByRole('button', { name: 'Open assets/logo.png after preview' })
    await fireEvent.click(afterPreview)

    expect(onOpenImage).toHaveBeenCalledWith({
      activeIndex: 1,
      images: [
        {
          alt: 'assets/logo.png old preview',
          filename: 'assets/logo.png',
          label: 'Before',
          src: 'data:image/png;base64,before-image',
        },
        {
          alt: 'assets/logo.png new preview',
          filename: 'assets/logo.png',
          label: 'After',
          src: 'data:image/png;base64,after-image',
        },
      ],
    })
  })

  it('preserves image previews for a pure image rename', async () => {
    const imageFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'assets/new-logo.png',
      previous_filename: 'assets/old-logo.png',
      status: 'renamed',
      patch: null,
      additions: 0,
      deletions: 0,
      changes: 0,
    }
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['assets/new-logo.png', { oldContent: 'old-image', newContent: 'new-image' }],
    ]))

    render(DiffViewer, {
      props: {
        files: [imageFile],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'assets/old-logo.png old preview' })).toBeTruthy()
      expect(screen.getByRole('img', { name: 'assets/new-logo.png new preview' })).toBeTruthy()
    })

    expect(screen.queryByText('File renamed without content changes.')).toBeNull()
  })

  it('re-fetches when includeUncommitted prop changes', async () => {
    const batchFn = vi.fn().mockResolvedValue(new Map([
      ['src/test.ts', { oldContent: '', newContent: 'content' }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [modifiedFileWithPatch],
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
      files: [modifiedFileWithPatch],
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
        files: [modifiedFileWithPatch, addedFileWithPatch],
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

describe('DiffViewData memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call toGitDiffViewData again on rerender when files and contents are unchanged', async () => {
    const mockToGitDiffViewData = vi.mocked(toGitDiffViewData)

    const { rerender } = render(DiffViewer, {
      props: { files: [modifiedFileWithPatch] },
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    const initialCallCount = mockToGitDiffViewData.mock.calls.length

    await rerender({ files: [modifiedFileWithPatch] })
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
        files: [modifiedFileWithPatch],
        batchFetchFileContents: batchFn,
      },
    })

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(1)
    })

    const callsAfterFirstRender = mockToGitDiffViewData.mock.calls.length

    // Rerender with same files and same batch function
    await rerender({
      files: [modifiedFileWithPatch],
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
