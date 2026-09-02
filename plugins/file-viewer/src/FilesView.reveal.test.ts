import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import type { FileContent } from '@openforge-app/plugin-sdk/domain'
import { get } from 'svelte/store'
import { fileBrowserStates, pendingFileReveal, requestFileReveal } from './lib/stores'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsReadDir,
  fsReadFile,
  makeFileEntry,
  noisyRootEntries,
  renderFilesView,
  resetFilesViewTestHarness,
  sampleFileContent,
} from './FilesView.test-harness'

describe('FilesView reveal behavior', () => {
  beforeEach(resetFilesViewTestHarness)

  it('moves focus to the preview pane after revealing a file', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    requestFileReveal('README.md')

    await waitFor(() => {
      const previewPane = screen.getByRole('region', { name: 'README.md preview pane' })
      expect(document.activeElement).toBe(previewPane)
    })
  })

  it('shows hidden root folders automatically when revealing a file inside one', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce(noisyRootEntries)
      .mockResolvedValueOnce([makeFileEntry({ name: 'log.txt', path: '.openforge-dev/log.txt' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    expect(screen.queryByText('.openforge-dev/')).toBeNull()

    requestFileReveal('.openforge-dev/log.txt')

    await waitFor(() => {
      expect(screen.getByText('.openforge-dev/')).toBeTruthy()
      expect(screen.getByText('log.txt')).toBeTruthy()
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: '.openforge-dev/log.txt' })
    })
  })

  it('expands parent directories and selects file for a pending reveal request', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'components', path: 'src/components', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'Button.ts', path: 'src/components/Button.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })

    requestFileReveal('src/components/Button.ts')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/components' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/components/Button.ts' })
    })
  })

  it('skips already-expanded parent directories when revealing a file', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'utils.ts', path: 'src/utils.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('utils.ts')).toBeTruthy()
    })

    vi.clearAllMocks()
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    requestFileReveal('src/utils.ts')

    await waitFor(() => {
      expect(fsReadDir).not.toHaveBeenCalled()
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/utils.ts' })
    })
  })

  it('retains a structured suffix in workspace state after processing a pending reveal', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    requestFileReveal('README.md', null, '?plain=1#setup')

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    })

    await waitFor(() => {
      expect(get(pendingFileReveal)).toBeNull()
    })
    expect(get(fileBrowserStates).get('project:test-project-id')).toMatchObject({
      selectedPath: 'README.md',
      selectedSuffix: '?plain=1#setup',
    })
  })

  it('applies a revealed fragment without adding its query or hash to the file read', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])
      vi.mocked(fsReadFile).mockResolvedValue({
        type: 'text',
        content: '# Intro\n\n## Setup\n\nLive instructions',
        mimeType: 'text/markdown',
        size: 37,
      })

      renderFilesView()
      await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())

      requestFileReveal('README.md', null, '?plain=1#setup')

      expect(await screen.findByRole('heading', { name: 'Setup' })).toBeTruthy()
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    } finally {
      if (originalScrollIntoView) {
        Element.prototype.scrollIntoView = originalScrollIntoView
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      }
    }
  })

  it('continues a pending reveal in the new project when the previous file read becomes stale', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md' })
    const projectBContent: FileContent = {
      type: 'text',
      content: 'Project B readme',
      mimeType: null,
      size: 16,
    }
    let resolveProjectARead!: (content: FileContent) => void
    const projectARead = new Promise<FileContent>((resolve) => {
      resolveProjectARead = resolve
    })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([readmeEntry])
      .mockResolvedValueOnce([readmeEntry])
    vi.mocked(fsReadFile)
      .mockReturnValueOnce(projectARead)
      .mockResolvedValueOnce(projectBContent)

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    requestFileReveal('README.md')
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-a', path: 'README.md' })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-b', path: 'README.md' })
      expect(screen.getByText('Project B readme')).toBeTruthy()
      expect(get(pendingFileReveal)).toBeNull()
    })

    resolveProjectARead(sampleFileContent)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('Project B readme')).toBeTruthy()
  })

  it('does not select a revealed file or clear pending reveal when parent expansion fails', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockRejectedValueOnce(new Error('Permission denied'))

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    requestFileReveal('src/secret.ts')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(get(pendingFileReveal)).toMatchObject({
      workspaceIdentity: null,
      path: 'src/secret.ts',
    })
  })

  it('retries a failed reveal with the original reveal path', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce([makeFileEntry({ name: 'secret.ts', path: 'src/secret.ts' })])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    requestFileReveal('src/secret.ts')

    await waitFor(() => {
      expect(screen.getByText('Unable to reveal src/secret.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry revealing src/secret.ts' }))

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/secret.ts' })
      expect(get(pendingFileReveal)).toBeNull()
    })
  })

  it('does not reveal before the root directory has loaded', async () => {
    vi.mocked(fsReadDir).mockReturnValue(new Promise(() => {}))

    renderFilesView()

    requestFileReveal('some/file.ts')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fsReadDir).toHaveBeenCalledTimes(1)
    expect(fsReadFile).not.toHaveBeenCalled()
  })
})
