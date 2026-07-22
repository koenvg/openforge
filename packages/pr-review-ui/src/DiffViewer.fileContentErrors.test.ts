import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import DiffViewer from './DiffViewer.svelte'

vi.mock('@git-diff-view/svelte', () => ({
  DiffView: vi.fn(),
  DiffModeEnum: { Split: 0, Unified: 1 },
  SplitSide: { old: 1, new: 2 },
}))

vi.mock('./useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('./diffSearch', () => ({
  findMatchesInContainer: vi.fn().mockReturnValue([]),
  applySearchHighlights: vi.fn(),
  applyOccurrenceHighlights: vi.fn(),
  clearSearchHighlights: vi.fn(),
  clearOccurrenceHighlights: vi.fn(),
  getWordAtSelection: vi.fn().mockReturnValue(null),
  scrollToMatch: vi.fn(),
  countMatchesInPatch: vi.fn().mockReturnValue(0),
}))

vi.mock('./useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      return Array.from({ length: opts.getCount() }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
        end: (index + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    totalSize: 0,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

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

describe('DiffViewer file-content fetch errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows a retryable image preview error after batch fetch rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const imageFile: PrFileDiff = {
      ...fileWithPatch,
      filename: 'assets/logo.png',
      status: 'added',
      patch: null,
      additions: 0,
      deletions: 0,
      changes: 0,
    }
    const batchFn = vi.fn()
      .mockRejectedValueOnce(new Error('Image content unavailable'))
      .mockResolvedValueOnce(new Map([
        ['assets/logo.png', { oldContent: '', newContent: 'base64-image' }],
      ]))

    render(DiffViewer, {
      props: {
        files: [imageFile],
        batchFetchFileContents: batchFn,
      },
    })

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load file contents')
    expect(error.textContent).toContain('Image content unavailable')
    expect(screen.queryByLabelText('Loading new image preview')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading assets/logo.png' }))

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('img', { name: 'assets/logo.png new preview' })).toBeTruthy()
    })
    consoleError.mockRestore()
  })

  it('shows a retryable image preview error when a partial batch omits the image', async () => {
    const imageFile: PrFileDiff = {
      ...fileWithPatch,
      filename: 'assets/logo.png',
      status: 'added',
      patch: null,
      additions: 0,
      deletions: 0,
      changes: 0,
    }
    const markdownFile: PrFileDiff = { ...fileWithPatch, filename: 'README.md' }
    const batchFn = vi.fn()
      .mockResolvedValueOnce(new Map([
        ['README.md', { oldContent: '# Before', newContent: '# After' }],
      ]))
      .mockResolvedValueOnce(new Map([
        ['assets/logo.png', { oldContent: '', newContent: 'base64-image' }],
      ]))

    render(DiffViewer, {
      props: {
        files: [markdownFile, imageFile],
        batchFetchFileContents: batchFn,
      },
    })

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load file contents')
    expect(error.textContent).toContain('No file contents were returned')
    expect(screen.queryByLabelText('Loading new image preview')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading assets/logo.png' }))

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(2)
      expect(batchFn).toHaveBeenLastCalledWith([imageFile])
      expect(screen.getByRole('img', { name: 'assets/logo.png new preview' })).toBeTruthy()
    })
  })

  it('shows a retryable Rich Diff View error after per-file fetch rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const markdownFile: PrFileDiff = { ...fileWithPatch, filename: 'README.md' }
    const perFileFn = vi.fn()
      .mockRejectedValueOnce(new Error('Markdown content unavailable'))
      .mockResolvedValueOnce({ oldContent: '# Before', newContent: '# Retried preview' })

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        fetchFileContents: perFileFn,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load file contents')
    expect(error.textContent).toContain('Markdown content unavailable')
    expect(screen.queryByRole('status', { name: 'Loading rich diff for README.md' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading README.md' }))

    await waitFor(() => {
      expect(perFileFn).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('heading', { name: 'Retried preview' })).toBeTruthy()
    })
    consoleError.mockRestore()
  })

  it('shows a retryable Rich Diff View error when the batch result is empty', async () => {
    const markdownFile: PrFileDiff = { ...fileWithPatch, filename: 'README.md' }
    const batchFn = vi.fn()
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([
        ['README.md', { oldContent: '# Before', newContent: '# Retried preview' }],
      ]))

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: batchFn,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load file contents')
    expect(error.textContent).toContain('No file contents were returned')
    expect(screen.queryByRole('status', { name: 'Loading rich diff for README.md' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading README.md' }))

    await waitFor(() => {
      expect(batchFn).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('heading', { name: 'Retried preview' })).toBeTruthy()
    })
  })
})
