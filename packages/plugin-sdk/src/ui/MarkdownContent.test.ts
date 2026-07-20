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
