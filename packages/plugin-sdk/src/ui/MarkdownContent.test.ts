import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent.svelte'

describe('MarkdownContent repository paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves nested relative images and keeps missing assets inert', async () => {
    const resolveRepositoryImage = vi.fn(async (path: string) => (
      path === 'docs/assets/diagram.png' ? 'data:image/png;base64,diagram' : null
    ))

    render(MarkdownContent, {
      props: {
        content: [
          '![Diagram](../assets/diagram.png)',
          '![Missing](../assets/missing.png)',
        ].join('\n'),
        markdownFilePath: 'docs/guides/README.md',
        resolveRepositoryImage,
      },
    })

    await waitFor(() => {
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/diagram.png')
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/missing.png')
      expect(screen.getByRole('img', { name: 'Diagram' }).getAttribute('src'))
        .toBe('data:image/png;base64,diagram')
    })

    const missingImage = screen.getByRole('img', { name: 'Missing' })
    expect(missingImage.getAttribute('src')).toBeNull()
    expect(missingImage.getAttribute('data-markdown-repository-path')).toBe('docs/assets/missing.png')
  })

  it('swaps in resolved remote images and falls back to the original URL', async () => {
    const resolveRemoteMedia = vi.fn(async (url: string) => (
      url === 'https://github.com/user-attachments/assets/upload-id'
        ? { url: 'https://private-user-images.githubusercontent.com/1/upload-id.png?jwt=signed', kind: 'image' as const }
        : null
    ))

    render(MarkdownContent, {
      props: {
        content: [
          '![Upload](https://github.com/user-attachments/assets/upload-id)',
          '![Badge](https://img.shields.io/badge.svg)',
        ].join('\n'),
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Upload' }).getAttribute('src'))
        .toBe('https://private-user-images.githubusercontent.com/1/upload-id.png?jwt=signed')
    })

    const badge = screen.getByRole('img', { name: 'Badge' })
    expect(badge.getAttribute('src')).toBe('https://img.shields.io/badge.svg')
    expect(badge.hasAttribute('data-markdown-remote-src')).toBe(false)
  })

  it('keeps the original remote image when resolution throws', async () => {
    const resolveRemoteMedia = vi.fn(async () => {
      throw new Error('sidecar unavailable')
    })

    render(MarkdownContent, {
      props: {
        content: '![Upload](https://github.com/user-attachments/assets/upload-id)',
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Upload' }).getAttribute('src'))
        .toBe('https://github.com/user-attachments/assets/upload-id')
    })
  })

  it('turns an uploaded recording into a player and leaves other links alone', async () => {
    const videoUrl = 'https://github.com/user-attachments/assets/recording-id'
    const signedUrl = 'https://private-user-images.githubusercontent.com/1/recording-id.mp4?jwt=signed'
    const resolveRemoteMedia = vi.fn(async (url: string) => (
      url === videoUrl ? { url: signedUrl, kind: 'video' as const } : null
    ))

    const { container } = render(MarkdownContent, {
      props: {
        content: [
          videoUrl,
          '',
          'https://example.com/not-an-upload',
        ].join('\n'),
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(container.querySelector('video')).toBeTruthy()
    })

    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBe(signedUrl)
    expect(video.hasAttribute('controls')).toBe(true)
    expect(container.querySelector(`a[href="${videoUrl}"]`)).toBeNull()

    const untouched = screen.getByRole('link', { name: 'https://example.com/not-an-upload' })
    expect(untouched.hasAttribute('data-markdown-remote-src')).toBe(false)
  })

  it('opens repository-relative links separately from external links', async () => {
    const onOpenRepositoryPath = vi.fn()
    const onOpenUrl = vi.fn()

    render(MarkdownContent, {
      props: {
        content: '[Setup](../SETUP.md#installation), [Website](https://example.com/docs), [CDN](//cdn.example.com/guide)',
        markdownFilePath: 'docs/guides/README.md',
        onOpenRepositoryPath,
        onOpenUrl,
      },
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith('docs/SETUP.md', '#installation')
    expect(onOpenUrl).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('link', { name: 'Website' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/docs')

    await fireEvent.click(screen.getByRole('link', { name: 'CDN' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://cdn.example.com/guide')
  })
})
