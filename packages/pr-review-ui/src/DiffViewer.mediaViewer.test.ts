import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
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

function imageFile(): PrFileDiff {
  return {
    sha: 'image-sha',
    filename: 'assets/logo.png',
    status: 'binary',
    additions: 0,
    deletions: 0,
    changes: 0,
    patch: null,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

function imageContents() {
  return vi.fn().mockResolvedValue(new Map([
    ['assets/logo.png', { oldContent: 'before-image', newContent: 'after-image' }],
  ]))
}

describe('DiffViewer package-owned media viewer', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens an image in a full-window dialog and returns focus when closed', async () => {
    render(DiffViewer, {
      props: { files: [imageFile()], batchFetchFileContents: imageContents() },
    })

    const trigger = await screen.findByRole('button', { name: 'Open assets/logo.png after preview' })
    await fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Media preview' })
    const viewer = within(dialog)
    expect(viewer.getByText('assets/logo.png')).toBeTruthy()
    expect(viewer.getByText('After')).toBeTruthy()
    expect(viewer.getByRole('img', { name: 'assets/logo.png new preview' }).getAttribute('src'))
      .toBe('data:image/png;base64,after-image')

    await fireEvent.click(viewer.getByRole('button', { name: 'Close media preview' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('closes when its file leaves or changes in the review context', async () => {
    const originalFile = imageFile()
    const { rerender } = render(DiffViewer, {
      props: { files: [originalFile], batchFetchFileContents: imageContents() },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Open assets/logo.png after preview' }))
    expect(screen.getByRole('dialog', { name: 'Media preview' })).toBeTruthy()

    await rerender({
      files: [{ ...originalFile, sha: 'replacement-sha' }],
      batchFetchFileContents: imageContents(),
    })
    expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull()
  })

  it('navigates image revisions with controls and arrow keys and toggles image sizing', async () => {
    render(DiffViewer, {
      props: { files: [imageFile()], batchFetchFileContents: imageContents() },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Open assets/logo.png after preview' }))
    const dialog = screen.getByRole('dialog', { name: 'Media preview' })
    const viewer = within(dialog)

    await fireEvent.click(viewer.getByRole('button', { name: 'Previous media' }))
    expect(viewer.getByText('Before')).toBeTruthy()
    expect(viewer.getByRole('img', { name: 'assets/logo.png old preview' }).getAttribute('src'))
      .toBe('data:image/png;base64,before-image')

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(viewer.getByText('After')).toBeTruthy()

    await fireEvent.click(viewer.getByRole('button', { name: 'Show image at actual size' }))
    expect(viewer.getByRole('button', { name: 'Fit image to window' })).toBeTruthy()
  })

  it('opens linked rich-diff images without replacing their link action', async () => {
    const markdownFile: PrFileDiff = {
      ...imageFile(),
      sha: 'markdown-sha',
      filename: 'docs/README.md',
      status: 'modified',
      patch: '@@ -1 +1 @@',
      changes: 1,
    }
    const onOpenUrl = vi.fn()

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '[![Diagram](assets/diagram.png)](https://example.com/full-size)',
        }]])),
        resolveRepositoryImage: vi.fn().mockResolvedValue('data:image/png;base64,diagram'),
        onOpenUrl,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))
    await fireEvent.click(await screen.findByRole('button', { name: 'Open Diagram image' }))
    const viewer = within(screen.getByRole('dialog', { name: 'Media preview' }))

    expect(viewer.getByText('Rich preview')).toBeTruthy()
    await fireEvent.click(viewer.getByRole('button', { name: 'Open link' }))

    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/full-size')
    expect(screen.getByRole('dialog', { name: 'Media preview' })).toBeTruthy()
  })
})
