import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import type { FileContents } from './diffAdapter'
import DiffViewer from './DiffViewer.svelte'

vi.mock('@git-diff-view/svelte', () => ({
  DiffView: vi.fn(),
  DiffModeEnum: { Split: 0, Unified: 1 },
  SplitSide: { old: 1, new: 2 },
}))

vi.mock('./useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({ getDiffFile: () => undefined })),
}))

vi.mock('./useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((options: { getCount: () => number }) => ({
    get virtualItems() {
      return Array.from({ length: options.getCount() }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
        end: (index + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    totalSize: 300,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

function videoFile(status: PrFileDiff['status'] = 'modified'): PrFileDiff {
  return {
    sha: 'video-sha',
    filename: 'assets/demo.mp4',
    status,
    additions: 0,
    deletions: 0,
    changes: status === 'renamed' ? 0 : 1,
    patch: null,
    previous_filename: status === 'renamed' ? 'assets/old-demo.mp4' : null,
    is_truncated: false,
    patch_line_count: null,
  }
}

function availableContents(): FileContents {
  return {
    oldContent: 'before-video',
    newContent: 'after-video',
    oldAvailability: { status: 'available', size: 12 },
    newAvailability: { status: 'available', size: 11 },
  }
}

function batchResult(file: PrFileDiff, contents: FileContents) {
  return vi.fn().mockResolvedValue(new Map([[file.filename, contents]]))
}

describe('DiffViewer video previews', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the native video controls without a custom full-window action', async () => {
    const file = videoFile()
    render(DiffViewer, { props: { files: [file], batchFetchFileContents: batchResult(file, availableContents()) } })

    const beforeVideo = await screen.findByLabelText('assets/demo.mp4 old preview') as HTMLVideoElement
    const afterVideo = screen.getByLabelText('assets/demo.mp4 new preview') as HTMLVideoElement

    expect(beforeVideo.controls).toBe(true)
    expect(beforeVideo.autoplay).toBe(false)
    expect(afterVideo.controls).toBe(true)
    expect(afterVideo.autoplay).toBe(false)
    expect(screen.queryByRole('button', { name: /Open assets\/demo\.mp4 .* preview/ })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull()
  })

  it('reports an inline playback failure without losing revision context', async () => {
    const file = videoFile()
    const { rerender } = render(DiffViewer, { props: { files: [file], batchFetchFileContents: batchResult(file, availableContents()) } })

    const video = await screen.findByLabelText('assets/demo.mp4 new preview')
    await fireEvent.error(video)

    expect(screen.getByRole('alert').textContent).toContain('This video cannot be played by this browser')
    expect(screen.getByText('After')).toBeTruthy()
    expect(screen.getByText('assets/demo.mp4')).toBeTruthy()

    const replacementFile = { ...file, sha: 'replacement-video-sha' }
    const replacementContents = { ...availableContents(), newContent: 'replacement-video' }
    await rerender({
      files: [replacementFile],
      batchFetchFileContents: batchResult(replacementFile, replacementContents),
    })

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect((screen.getByLabelText('assets/demo.mp4 new preview') as HTMLVideoElement).src)
      .toContain('replacement-video')
  })

  it.each([
    ['added', false, true],
    ['removed', true, false],
    ['renamed', true, true],
  ] as const)('renders the available sides for a %s video', async (status, hasBefore, hasAfter) => {
    const file = videoFile(status)
    const contents = availableContents()
    if (!hasBefore) {
      contents.oldContent = ''
      contents.oldAvailability = { status: 'missing' }
    }
    if (!hasAfter) {
      contents.newContent = ''
      contents.newAvailability = { status: 'missing' }
    }

    render(DiffViewer, { props: { files: [file], batchFetchFileContents: batchResult(file, contents) } })

    await waitFor(() => expect(screen.queryByLabelText('Loading new video preview')).toBeNull())
    expect(screen.queryByLabelText(/ old preview$/) !== null).toBe(hasBefore)
    expect(screen.queryByLabelText(/ new preview$/) !== null).toBe(hasAfter)
  })

  it.each([
    ['image to video', 'assets/before.png', 'assets/after.mp4', 'IMG', 'VIDEO'],
    ['video to image', 'assets/before.mp4', 'assets/after.png', 'VIDEO', 'IMG'],
  ] as const)('classifies each side of an %s rename independently', async (_label, oldFilename, newFilename, oldTag, newTag) => {
    const file = {
      ...videoFile('renamed'),
      filename: newFilename,
      previous_filename: oldFilename,
    }
    render(DiffViewer, { props: { files: [file], batchFetchFileContents: batchResult(file, availableContents()) } })

    const oldPreview = oldTag === 'IMG'
      ? await screen.findByAltText(`${oldFilename} old preview`)
      : await screen.findByLabelText(`${oldFilename} old preview`)
    const newPreview = newTag === 'IMG'
      ? screen.getByAltText(`${newFilename} new preview`)
      : screen.getByLabelText(`${newFilename} new preview`)

    expect(oldPreview.tagName).toBe(oldTag)
    expect(newPreview.tagName).toBe(newTag)

    const imagePreview = oldTag === 'IMG' ? oldPreview : newPreview
    const imageButton = imagePreview.closest('button')
    expect(imageButton).not.toBeNull()
    await fireEvent.click(imageButton!)

    const dialog = screen.getByRole('dialog', { name: 'Media preview' })
    expect(dialog.querySelector('img')).not.toBeNull()
    expect(dialog.querySelector('video')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Media navigation' })).toBeNull()
  })

  it('requests visible video contents and shows loading state until they arrive', async () => {
    const file = videoFile()
    let resolveContents!: (contents: Map<string, FileContents>) => void
    const batchFetchFileContents = vi.fn().mockReturnValue(new Promise<Map<string, FileContents>>((resolve) => {
      resolveContents = resolve
    }))

    render(DiffViewer, { props: { files: [file], batchFetchFileContents } })

    expect(screen.getByLabelText('Loading old video preview')).toBeTruthy()
    expect(screen.getByLabelText('Loading new video preview')).toBeTruthy()
    await waitFor(() => expect(batchFetchFileContents).toHaveBeenCalledWith([file]))

    resolveContents(new Map([[file.filename, availableContents()]]))
    expect(await screen.findByLabelText('assets/demo.mp4 new preview')).toBeTruthy()
  })

  it('renders typed too-large and missing revision states without broken players', async () => {
    const file = videoFile()
    const contents: FileContents = {
      oldContent: '',
      newContent: '',
      oldAvailability: { status: 'too-large', size: 30 * 1024 * 1024 },
      newAvailability: { status: 'missing' },
    }
    render(DiffViewer, { props: { files: [file], batchFetchFileContents: batchResult(file, contents) } })

    expect(await screen.findByText(/too large to preview/i)).toBeTruthy()
    expect(screen.getByText('No video revision available')).toBeTruthy()
    expect(document.querySelectorAll('video')).toHaveLength(0)
  })

  it('renders typed load failures with a retry that can recover', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const file = videoFile('added')
    const batchFetchFileContents = vi.fn()
      .mockResolvedValueOnce(new Map([[file.filename, {
        oldContent: '',
        newContent: '',
        oldAvailability: { status: 'missing' },
        newAvailability: { status: 'load-failed', message: 'Temporary GitHub failure' },
      }]]))
      .mockResolvedValueOnce(new Map([[file.filename, availableContents()]]))

    render(DiffViewer, { props: { files: [file], batchFetchFileContents } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Temporary GitHub failure')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading assets/demo.mp4' }))

    expect(await screen.findByLabelText('assets/demo.mp4 new preview')).toBeTruthy()
    expect(batchFetchFileContents).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })
})
