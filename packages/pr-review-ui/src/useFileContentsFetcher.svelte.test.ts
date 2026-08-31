import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import type { FileContents } from './diffAdapter'

import { createFileContentsFetcher } from './useFileContentsFetcher.svelte'
import type { FileContentsFetcherState } from './useFileContentsFetcher.svelte'

// ============================================================================
// Fixtures
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

const fileNoPatch: PrFileDiff = {
  sha: 'ghi789',
  filename: 'src/nopatch.ts',
  status: 'renamed',
  additions: 0,
  deletions: 0,
  changes: 0,
  patch: null,
  previous_filename: 'src/old.ts',
  is_truncated: false,
  patch_line_count: null,
}


const videoFile: PrFileDiff = {
  ...fileNoPatch,
  filename: 'recordings/demo.MP4',
  previous_filename: null,
  status: 'binary',
}
// ============================================================================
// Tests
// ============================================================================

describe('createFileContentsFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  it('starts with an empty fileContentsMap', () => {
    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => undefined,
      })
    })

    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not fetch when no fetcher is provided', async () => {
    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not fetch when files list is empty', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map())

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).not.toHaveBeenCalled()
    cleanup()
  })

  it('does not fetch for non-image files without patches', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map())

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileNoPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).not.toHaveBeenCalled()
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('fetches image files without patches so previews can render', async () => {
    const imageFile: PrFileDiff = {
      ...fileNoPatch,
      filename: 'assets/logo.png',
      status: 'binary',
    }
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['assets/logo.png', { oldContent: '', newContent: 'base64-image' }],
      ]))

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [imageFile],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles.map(f => f.filename)).toEqual(['assets/logo.png'])
    expect(fetcher.fileContentsMap.get('assets/logo.png')?.newContent).toBe('base64-image')
    cleanup()
  })

  it('loads a video only after an explicit request and only once', async () => {
    const contents: FileContents = {
      oldContent: '',
      newContent: '',
      oldAvailability: { status: 'missing' },
      newAvailability: { status: 'too-large', size: 26_214_401 },
    }
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>().mockResolvedValue(contents)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [videoFile],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(perFileFn).not.toHaveBeenCalled()

    fetcher.requestFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(perFileFn).toHaveBeenCalledTimes(1)
    expect(fetcher.fileContentsMap.get(videoFile.filename)).toEqual(contents)

    fetcher.requestFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(perFileFn).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('retries an explicitly requested video after a failed load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recovered: FileContents = {
      oldContent: '',
      newContent: '',
      oldAvailability: { status: 'missing' },
      newAvailability: { status: 'load-failed', message: 'Browser could not decode this video.' },
    }
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(recovered)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [videoFile],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    fetcher.requestFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentErrors.get(videoFile.filename)).toBe('network failed')

    fetcher.retryFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(perFileFn).toHaveBeenCalledTimes(2)
    expect(fetcher.fileContentErrors.has(videoFile.filename)).toBe(false)
    expect(fetcher.fileContentsMap.get(videoFile.filename)?.newAvailability).toEqual(recovered.newAvailability)
    cleanup()
    consoleError.mockRestore()
  })

  it('discards an explicitly requested video result after the file leaves the review', async () => {
    let resolveVideo!: (contents: FileContents) => void
    const pending = new Promise<FileContents>(resolve => { resolveVideo = resolve })
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>().mockReturnValue(pending)
    let files = $state<PrFileDiff[]>([videoFile])
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => files,
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    fetcher.requestFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 0))
    files = []
    flushSync()
    resolveVideo({ oldContent: '', newContent: 'stale-video' })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(fetcher.fileContentsMap.has(videoFile.filename)).toBe(false)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Batch fetching
  // --------------------------------------------------------------------------

  it('calls batchFetchFileContents with files that have patches', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: 'old', newContent: 'new' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles.map(f => f.filename)).toContain('src/test.ts')
    cleanup()
  })

  it('populates fileContentsMap after batch fetch', async () => {
    const contents: FileContents = { oldContent: 'old', newContent: 'new' }
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([['src/test.ts', contents]]))

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')).toBe(contents)
    cleanup()
  })

  it('batches all files in a single call', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'a' }],
        ['src/other.ts', { oldContent: '', newContent: 'b' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch, fileWithPatch2],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    const [calledFiles] = batchFn.mock.calls[0] as [PrFileDiff[]]
    expect(calledFiles).toHaveLength(2)
    cleanup()
  })

  it('does not duplicate an in-flight batch when a video is requested later', async () => {
    let resolveText!: (contents: Map<string, FileContents>) => void
    let resolveVideo!: (contents: Map<string, FileContents>) => void
    const textBatch = new Promise<Map<string, FileContents>>(resolve => { resolveText = resolve })
    const videoBatch = new Promise<Map<string, FileContents>>(resolve => { resolveVideo = resolve })
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockReturnValueOnce(textBatch)
      .mockReturnValueOnce(videoBatch)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch, videoFile],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(batchFn).toHaveBeenCalledTimes(1)
    expect(batchFn.mock.calls[0]?.[0].map(file => file.filename)).toEqual([fileWithPatch.filename])

    fetcher.requestFileContents(videoFile.filename)
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(batchFn).toHaveBeenCalledTimes(2)
    expect(batchFn.mock.calls[1]?.[0].map(file => file.filename)).toEqual([videoFile.filename])

    resolveVideo(new Map([[videoFile.filename, { oldContent: '', newContent: 'video' }]]))
    resolveText(new Map([[fileWithPatch.filename, { oldContent: 'old', newContent: 'text' }]]))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(fetcher.fileContentsMap.get(fileWithPatch.filename)?.newContent).toBe('text')
    expect(fetcher.fileContentsMap.get(videoFile.filename)?.newContent).toBe('video')
    cleanup()
  })

  it('prefers batch fetch over per-file fetch when both are provided', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([['src/test.ts', { oldContent: '', newContent: 'a' }]]))
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue({ oldContent: '', newContent: 'a' })

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)
    expect(perFileFn).not.toHaveBeenCalled()
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Per-file fetching
  // --------------------------------------------------------------------------

  it('calls fetchFileContents for each file when no batch fetcher is provided', async () => {
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue({ oldContent: '', newContent: 'content' })

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch, fileWithPatch2],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(perFileFn).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('populates fileContentsMap after per-file fetch', async () => {
    const contents: FileContents = { oldContent: 'a', newContent: 'b' }
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockResolvedValue(contents)

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')).toBe(contents)
    cleanup()
  })

  // --------------------------------------------------------------------------
  // Generation tracking (stale request detection)
  // --------------------------------------------------------------------------

  it('discards stale batch results when generation changes', async () => {
    let resolveFirst!: (value: Map<string, FileContents>) => void
    const firstPromise = new Promise<Map<string, FileContents>>(r => { resolveFirst = r })

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(new Map([['src/test.ts', { oldContent: 'fresh', newContent: 'fresh' }]]))

    let includeUncommitted = $state(false)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    // Effect runs — first fetch started (pending)
    await new Promise(resolve => setTimeout(resolve, 0))

    // Toggle includeUncommitted → resets and triggers new generation + new fetch
    includeUncommitted = true
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Now resolve the first (stale) promise — should be discarded
    resolveFirst(new Map([['src/test.ts', { oldContent: 'stale', newContent: 'stale' }]]))
    await new Promise(resolve => setTimeout(resolve, 10))

    // The fresh fetch result should win, not the stale one
    const result = fetcher.fileContentsMap.get('src/test.ts')
    expect(result?.newContent).not.toBe('stale')
    cleanup()
  })

  // --------------------------------------------------------------------------
  // includeUncommitted toggle
  // --------------------------------------------------------------------------

  it('resets fetch state when includeUncommitted changes', async () => {
    let includeUncommitted = $state(false)

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'content' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    // Wait for initial fetch
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)

    // Change includeUncommitted — should reset and re-fetch
    includeUncommitted = true
    flushSync()

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('resets fetch state when includeCommitted changes', async () => {
    let includeCommitted = $state(true)

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'content' }],
      ]))

    const cleanup = $effect.root(() => {
      createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeCommitted: () => includeCommitted,
        getIncludeUncommitted: () => true,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    // Wait for initial fetch
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(1)

    // Toggling committed off (uncommitted-only) changes the diff base, so cached
    // contents must be discarded and re-fetched.
    includeCommitted = false
    flushSync()

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('discards in-flight contents when the same filename changes comparison context before results arrive', async () => {
    const comparisonFile: PrFileDiff = {
      ...fileWithPatch,
      patch: '@@ -1,1 +1,1 @@\n-reviewed\n+changed since review',
      additions: 1,
      deletions: 1,
      changes: 2,
    }
    let resolveFirst!: (value: Map<string, FileContents>) => void
    const firstPromise = new Promise<Map<string, FileContents>>(resolve => { resolveFirst = resolve })
    let files = $state<PrFileDiff[]>([fileWithPatch])
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(new Map([
        ['src/test.ts', { oldContent: 'reviewed', newContent: 'changed since review' }],
      ]))

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => files,
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 0))

    files = [comparisonFile]
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))

    resolveFirst(new Map([
      ['src/test.ts', { oldContent: 'base', newContent: 'reviewed' }],
    ]))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(batchFn).toHaveBeenCalledTimes(2)
    expect(fetcher.fileContentsMap.get('src/test.ts')?.newContent).toBe('changed since review')
    cleanup()
  })

  it('refetches contents when the same filename changes comparison context', async () => {
    const comparisonFile: PrFileDiff = {
      ...fileWithPatch,
      patch: '@@ -1,1 +1,1 @@\n-reviewed\n+changed since review',
      additions: 1,
      deletions: 1,
      changes: 2,
    }
    let files = $state<PrFileDiff[]>([fileWithPatch])
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValueOnce(new Map([
        ['src/test.ts', { oldContent: 'base', newContent: 'reviewed' }],
      ]))
      .mockResolvedValueOnce(new Map([
        ['src/test.ts', { oldContent: 'reviewed', newContent: 'changed since review' }],
      ]))

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => files,
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')?.newContent).toBe('reviewed')

    files = [comparisonFile]
    flushSync()

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(2)
    expect(batchFn).toHaveBeenLastCalledWith([comparisonFile])
    expect(fetcher.fileContentsMap.get('src/test.ts')?.newContent).toBe('changed since review')
    cleanup()
  })

  it('clears fileContentsMap when includeUncommitted toggles', async () => {
    let includeUncommitted = $state(false)

    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValueOnce(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'first' }],
      ]))
      .mockResolvedValue(new Map())

    let fetcher!: FileContentsFetcherState
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.size).toBe(1)

    // Toggle — map should clear
    includeUncommitted = true
    flushSync()
    // After flushSync, the reset effect has run, clearing fileContentsMap
    expect(fetcher.fileContentsMap.size).toBe(0)
    cleanup()
  })

  it('does not reset on first render (prevIncludeUncommitted guard)', async () => {
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockResolvedValue(new Map([
        ['src/test.ts', { oldContent: '', newContent: 'content' }],
      ]))

    let fetcher!: FileContentsFetcherState
    // includeUncommitted starts as true — should NOT trigger a reset
    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => true,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    // Only one fetch (initial), not two (no spurious reset)
    expect(batchFn).toHaveBeenCalledTimes(1)
    expect(fetcher.fileContentsMap.size).toBe(1)
    cleanup()
  })

  it('discards a stale per-file rejection after the diff basis changes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectFirst!: (error: Error) => void
    const firstPromise = new Promise<FileContents>((_resolve, reject) => { rejectFirst = reject })
    const perFileFn = vi.fn<(file: PrFileDiff) => Promise<FileContents>>()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ oldContent: 'fresh old', newContent: 'fresh new' })
    let includeUncommitted = $state(false)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch],
        getIncludeUncommitted: () => includeUncommitted,
        getFetchFileContents: () => perFileFn,
        getBatchFetchFileContents: () => undefined,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    includeUncommitted = true
    flushSync()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentsMap.get('src/test.ts')?.newContent).toBe('fresh new')

    rejectFirst(new Error('stale failure'))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(fetcher.fileContentErrors.has('src/test.ts')).toBe(false)
    expect(fetcher.fileContentsMap.get('src/test.ts')?.newContent).toBe('fresh new')
    cleanup()
    consoleError.mockRestore()
  })

  it('clears every failed batch entry when retrying the batch', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveRetry!: (contents: Map<string, FileContents>) => void
    const retryPromise = new Promise<Map<string, FileContents>>(resolve => { resolveRetry = resolve })
    const batchFn = vi.fn<(files: PrFileDiff[]) => Promise<Map<string, FileContents>>>()
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockReturnValueOnce(retryPromise)
    let fetcher!: FileContentsFetcherState

    const cleanup = $effect.root(() => {
      fetcher = createFileContentsFetcher({
        getFiles: () => [fileWithPatch, fileWithPatch2],
        getIncludeUncommitted: () => false,
        getFetchFileContents: () => undefined,
        getBatchFetchFileContents: () => batchFn,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetcher.fileContentErrors.size).toBe(2)

    fetcher.retryFileContents('src/test.ts')
    flushSync()

    expect(fetcher.fileContentErrors.size).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(batchFn).toHaveBeenCalledTimes(2)

    resolveRetry(new Map())
    cleanup()
    consoleError.mockRestore()
  })
})
