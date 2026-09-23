import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FileContent } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import FilePreviewHeader from './FilePreviewHeader.svelte'
import FileTextPreview from './FileTextPreview.svelte'
import FileMediaPreview from './FileMediaPreview.svelte'
import FileUnavailablePreview from './FileUnavailablePreview.svelte'

const api = {} as FrontendOpenForgeAPI
const text: FileContent = { type: 'text', content: 'first\nsecond', size: 12, mimeType: 'text/plain' }

describe('file preview presentations', () => {
  it('shows selected file metadata and returns focus through its public action', async () => {
    const onReturnFocusToTree = vi.fn()
    render(FilePreviewHeader, { props: { content: text, fileName: 'notes.txt', modifiedAt: null, onReturnFocusToTree } })

    expect(screen.getByText('12 B')).toBeTruthy()
    expect(screen.getByText('2 lines')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Return focus to selected file in tree' }))
    expect(onReturnFocusToTree).toHaveBeenCalledOnce()
  })

  it('shows text with numbered lines and reports scrolling through its public callback', async () => {
    const onScrollTopChange = vi.fn()
    render(FileTextPreview, { props: { api, content: text.content, fileName: 'notes.txt', filePath: 'notes.txt', workspaceSource: null, scrollTop: 0, onScrollTopChange, registerScrollRegion: () => {} } })

    const region = screen.getByRole('region', { name: 'File text content' })
    expect(region.textContent).toContain('first')
    expect(region.textContent).toContain('second')
    expect(screen.getByText('2')).toBeTruthy()
    region.scrollTop = 37
    await fireEvent.scroll(region)
    expect(onScrollTopChange).toHaveBeenCalledWith(37)
  })

  it('keeps Markdown links within the repository selection callback', async () => {
    const onOpenRepositoryPath = vi.fn()
    render(FileTextPreview, { props: {
      api, content: '[Setup](../SETUP.md)', fileName: 'README.md', filePath: 'docs/guides/README.md',
      workspaceSource: null, registerScrollRegion: () => {}, onOpenRepositoryPath,
    } })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith('docs/SETUP.md')
  })

  it('shows an image in a named preview region without video controls', () => {
    render(FileMediaPreview, { props: { content: { type: 'image', content: 'aGVsbG8=', size: 5, mimeType: 'image/png' }, fileName: 'logo.png', videoPlaybackError: false, registerScrollRegion: () => {}, registerVideoElement: () => {} } })
    expect(screen.getByRole('img', { name: 'logo.png preview' }).getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(screen.getByRole('region', { name: 'Image file content' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows native video controls and forwards playback failures', async () => {
    const onVideoError = vi.fn()
    const video: FileContent = { type: 'video', content: 'AAE=', size: 2, mimeType: 'video/mp4' }
    const { rerender } = render(FileMediaPreview, { props: { content: video, fileName: 'demo.mp4', videoPlaybackError: false, onVideoError, registerScrollRegion: () => {}, registerVideoElement: () => {} } })
    const player = screen.getByLabelText('demo.mp4 preview') as HTMLVideoElement
    expect(player.controls).toBe(true)
    expect(player.autoplay).toBe(false)
    await fireEvent.error(player)
    expect(onVideoError).toHaveBeenCalledOnce()
    await rerender({ content: video, fileName: 'demo.mp4', videoPlaybackError: true, onVideoError, registerScrollRegion: () => {}, registerVideoElement: () => {} })
    expect(screen.getByRole('alert').textContent).toContain('Video playback unavailable')
  })

  it.each([
    [{ type: 'binary', content: '', size: 1, mimeType: null }, 'Binary preview unavailable'],
    [{ type: 'document', content: '', size: 1, mimeType: 'application/pdf' }, 'Document preview unavailable'],
    [{ type: 'large-file', content: '', size: 1, mimeType: null }, 'File too large to preview'],
  ] as const)('explains why %s cannot be previewed', (content, message) => {
    render(FileUnavailablePreview, { props: { content, filePath: 'file', modifiedAt: null, workspaceSource: null } })
    expect(screen.getByText(message)).toBeTruthy()
  })
})
