import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import type { FileContent } from '@openforge-app/plugin-sdk/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsReadDir,
  fsReadFile,
  makeFileEntry,
  renderFilesView,
  resetFilesViewTestHarness,
  sampleEntries,
  sampleFileContent,
} from './FilesView.test-harness'
import { requestFileReveal } from './lib/stores'

describe('FilesView selection and preview', () => {
  beforeEach(resetFilesViewTestHarness)

  it('loads selected file content through the typed runtime fs API', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    })
  })

  it('moves focus to the preview pane after selecting a file and exposes a keyboard return path', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    await waitFor(() => {
      const previewPane = screen.getByRole('region', { name: 'README.md preview pane' })
      expect(document.activeElement).toBe(previewPane)
      expect(screen.getByRole('button', { name: /Return focus to selected file in tree/ })).toBeTruthy()
    })
  })

  it('returns focus from the preview pane to the selected tree item', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    const selectedFileTreeItem = screen.getByRole('treeitem', { name: /README.md/ })
    await fireEvent.click(selectedFileTreeItem)

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'README.md preview pane' }))
    })

    await fireEvent.click(screen.getByRole('button', { name: /Return focus to selected file in tree/ }))

    await waitFor(() => {
      expect(document.activeElement).toBe(selectedFileTreeItem)
    })
  })

  it('refetches the open file when returning to a project after a stale response was ignored', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false })
    let resolveStaleRead!: (content: FileContent) => void
    const staleRead = new Promise<FileContent>((resolve) => {
      resolveStaleRead = resolve
    })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([readmeEntry])
      .mockResolvedValueOnce([])
    vi.mocked(fsReadFile)
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(sampleFileContent)

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-a', path: 'README.md' })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    resolveStaleRead(sampleFileContent)

    await rerender({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Hello world')).toBeTruthy()
    })
  })

  it('resolves markdown file preview images relative to the selected project file through the typed fs API', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'docs', path: 'docs', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'guides', path: 'docs/guides', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'README.md', path: 'docs/guides/README.md' })])

    vi.mocked(fsReadFile).mockImplementation(async (request: { path: string }) => {
      switch (request.path) {
        case 'docs/guides/README.md':
          return {
            type: 'text',
            content: [
              '![Same directory](./diagram.png)',
              '![Parent directory](../assets/logo.png)',
              '![Project root](/images/root.png)',
            ].join('\n'),
            mimeType: 'text/markdown',
            size: 111,
          }
        case 'docs/guides/diagram.png':
          return { type: 'image', content: 'same-image', mimeType: 'image/png', size: 10 }
        case 'docs/assets/logo.png':
          return { type: 'image', content: 'parent-image', mimeType: 'image/png', size: 12 }
        case 'images/root.png':
          return { type: 'image', content: 'root-image', mimeType: 'image/png', size: 14 }
        default:
          throw new Error(`Unexpected file read: ${request.path}`)
      }
    })

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs/')).toBeTruthy()
    })

    requestFileReveal('docs/guides/README.md')

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'docs/guides/README.md' })
    })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'docs/guides/diagram.png' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'docs/assets/logo.png' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'images/root.png' })
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Same directory' }).getAttribute('src')).toBe('data:image/png;base64,same-image')
      expect(screen.getByRole('img', { name: 'Parent directory' }).getAttribute('src')).toBe('data:image/png;base64,parent-image')
      expect(screen.getByRole('img', { name: 'Project root' }).getAttribute('src')).toBe('data:image/png;base64,root-image')
    })
  })
})
