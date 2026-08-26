import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '../../../../lib/types'
import './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

describe('DiffViewer Rich Diff View', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults Markdown files to Source and renders the post-change document in Rich view', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
    }
    const batchFetchFileContents = vi.fn().mockResolvedValue(new Map([
      ['README.md', {
        oldContent: '# Previous heading\n',
        newContent: '# Updated heading\n\n**Rendered body**\n',
      }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents,
      },
    })

    const sourceButton = screen.getByRole('button', { name: 'Show source diff for README.md' })
    const richButton = screen.getByRole('button', { name: 'Show rich diff for README.md' })
    expect(sourceButton.getAttribute('aria-pressed')).toBe('true')
    expect(richButton.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('heading', { name: 'Updated heading' })).toBeNull()

    await fireEvent.click(richButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Updated heading' })).toBeTruthy()
      expect(screen.getByText('Rendered body').tagName).toBe('STRONG')
    })
    expect(sourceButton.getAttribute('aria-pressed')).toBe('false')
    expect(richButton.getAttribute('aria-pressed')).toBe('true')

    const replacementFile: PrFileDiff = {
      ...markdownFile,
      sha: 'replacement-sha',
      patch: '@@ -1 +1 @@\n-# Updated heading\n+# Replacement heading',
    }
    const replacementFetch = vi.fn().mockResolvedValue(new Map([
      ['README.md', {
        oldContent: '# Updated heading\n',
        newContent: '# Replacement heading\n',
      }],
    ]))

    await rerender({
      files: [replacementFile],
      batchFetchFileContents: replacementFetch,
    })

    expect(screen.getByRole('button', { name: 'Show source diff for README.md' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show rich diff for README.md' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('resolves nested worktree images and links through Rich Diff repository callbacks', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/guides/README.md' }
    const resolveRepositoryImage = vi.fn().mockResolvedValue('data:image/png;base64,diagram')
    const onOpenRepositoryPath = vi.fn()
    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
        }]])),
        resolveRepositoryImage,
        onOpenRepositoryPath,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))

    await waitFor(() => {
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/diagram.png')
      expect(screen.getByAltText('Diagram').getAttribute('src')).toBe('data:image/png;base64,diagram')
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith('docs/SETUP.md', '')
  })

  it('reports images opened from a Rich Diff View', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/README.md' }
    const onOpenImage = vi.fn()

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](assets/diagram.png)',
        }]])),
        resolveRepositoryImage: vi.fn().mockResolvedValue('data:image/png;base64,diagram'),
        onOpenImage,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))
    const imageButton = await screen.findByRole('button', { name: 'Open Diagram image' })
    await fireEvent.click(imageButton)

    expect(onOpenImage).toHaveBeenCalledWith({
      activeIndex: 0,
      images: [{
        alt: 'Diagram',
        filename: 'docs/README.md',
        label: 'Rich preview',
        src: 'data:image/png;base64,diagram',
      }],
    })
  })

  it('resolves nested GitHub Rich Diff images and links at the pull request head', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/guides/README.md' }
    const onOpenUrl = vi.fn()
    render(DiffViewer, {
      props: {
        files: [markdownFile],
        repoOwner: 'acme',
        repoName: 'repo',
        headSha: 'abc123',
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
        }]])),
        onOpenUrl,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))

    await waitFor(() => {
      expect(screen.getByAltText('Diagram').getAttribute('src'))
        .toBe('https://raw.githubusercontent.com/acme/repo/abc123/docs/assets/diagram.png')
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/acme/repo/blob/abc123/docs/SETUP.md')
  })
})
