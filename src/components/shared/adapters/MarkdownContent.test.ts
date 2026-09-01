import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent.svelte'

vi.mock('../../../lib/ipc', () => ({
  openUrl: vi.fn(),
}))

describe('MarkdownContent', () => {
  it('resolves relative image sources against the supplied image base URL', () => {
    render(MarkdownContent, {
      props: {
        content: '![Architecture](docs/architecture.png)',
        imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
      },
    })

    const image = screen.getByRole('img', { name: 'Architecture' })
    expect(image.getAttribute('src')).toBe('https://raw.githubusercontent.com/acme/repo/abc123/docs/architecture.png')
  })

  it('keeps absolute markdown image sources unchanged', () => {
    render(MarkdownContent, {
      props: {
        content: '![Uploaded](https://github.com/user-attachments/assets/image-id)',
        imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
      },
    })

    const image = screen.getByRole('img', { name: 'Uploaded' })
    expect(image.getAttribute('src')).toBe('https://github.com/user-attachments/assets/image-id')
  })

  it('shows resolved uploads as pictures or players', async () => {
    const imageUrl = 'https://github.com/user-attachments/assets/image-id'
    const videoUrl = 'https://github.com/user-attachments/assets/recording-id'
    const resolveRemoteMedia = vi.fn(async (url: string) => {
      if (url === imageUrl) return { url: 'https://cdn.example.com/shot.gif?jwt=signed', kind: 'image' as const }
      if (url === videoUrl) return { url: 'https://cdn.example.com/clip.mp4?jwt=signed', kind: 'video' as const }
      return null
    })

    const { container } = render(MarkdownContent, {
      props: {
        content: `![Uploaded](${imageUrl})\n\n${videoUrl}`,
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Uploaded' }).getAttribute('src'))
        .toBe('https://cdn.example.com/shot.gif?jwt=signed')
      expect(container.querySelector('video')?.getAttribute('src'))
        .toBe('https://cdn.example.com/clip.mp4?jwt=signed')
    })
  })

  it('passes structured repository link targets to Review callers', async () => {
    const onOpenRepositoryPath = vi.fn()
    render(MarkdownContent, {
      props: {
        content: '[Setup](../SETUP.md?plain=1#installation)',
        markdownFilePath: 'docs/guides/README.md',
        onOpenRepositoryPath,
      },
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith({
      repositoryPath: 'docs/SETUP.md',
      suffix: '?plain=1#installation',
    })
  })
})
