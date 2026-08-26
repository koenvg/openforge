import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '../../../../lib/types'
import './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

function imageFile(): PrFileDiff {
  return {
    ...modifiedFileWithPatch,
    filename: 'assets/logo.png',
    status: 'binary',
    patch: null,
    additions: 0,
    deletions: 0,
    changes: 0,
  }
}

function imageContents() {
  return vi.fn().mockResolvedValue(new Map([
    ['assets/logo.png', { oldContent: 'before-image', newContent: 'after-image' }],
  ]))
}

describe('DiffViewer image lightbox', () => {
  it('opens an image in a full-window dialog and returns focus when closed', async () => {
    render(DiffViewer, {
      props: {
        files: [imageFile()],
        batchFetchFileContents: imageContents(),
      },
    })

    const trigger = await screen.findByRole('button', { name: 'Open assets/logo.png after preview' })
    await fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    expect(dialog).toBeTruthy()
    const lightbox = within(dialog)
    expect(lightbox.getByText('assets/logo.png')).toBeTruthy()
    expect(lightbox.getByText('After')).toBeTruthy()
    expect(lightbox.getByRole('img', { name: 'assets/logo.png new preview' }).getAttribute('src'))
      .toBe('data:image/png;base64,after-image')

    await fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('closes when its image leaves the review context', async () => {
    const { rerender } = render(DiffViewer, {
      props: {
        files: [imageFile()],
        batchFetchFileContents: imageContents(),
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Open assets/logo.png after preview' }))
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeTruthy()

    await rerender({ files: [], batchFetchFileContents: imageContents() })

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })

  it('navigates the gallery with buttons and keys and toggles image sizing', async () => {
    render(DiffViewer, {
      props: {
        files: [imageFile()],
        batchFetchFileContents: imageContents(),
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Open assets/logo.png after preview' }))
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const lightbox = within(dialog)

    await fireEvent.click(lightbox.getByRole('button', { name: 'Previous image' }))
    expect(lightbox.getByText('Before')).toBeTruthy()
    expect(lightbox.getByRole('img', { name: 'assets/logo.png old preview' }).getAttribute('src'))
      .toBe('data:image/png;base64,before-image')

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(lightbox.getByText('After')).toBeTruthy()

    await fireEvent.click(lightbox.getByRole('button', { name: 'Show image at actual size' }))
    expect(lightbox.getByRole('button', { name: 'Fit image to window' })).toBeTruthy()

    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })

  it('opens linked Rich Diff View images without losing the link action', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/README.md' }
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
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const lightbox = within(dialog)

    expect(lightbox.getByText('Rich preview')).toBeTruthy()
    await fireEvent.click(lightbox.getByRole('button', { name: 'Open link' }))

    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/full-size')
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeTruthy()
  })

  it('closes when the reviewed file changes beneath an open image', async () => {
    const originalFile = imageFile()
    const { rerender } = render(DiffViewer, {
      props: {
        files: [originalFile],
        batchFetchFileContents: imageContents(),
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Open assets/logo.png after preview' }))

    await rerender({
      files: [{ ...originalFile, sha: 'replacement-sha' }],
      batchFetchFileContents: imageContents(),
    })

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })
})
