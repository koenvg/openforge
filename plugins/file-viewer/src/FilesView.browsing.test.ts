import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsReadDir,
  fsReadFile,
  makeFileEntry,
  noisyRootEntries,
  renderFilesView,
  resetFilesViewTestHarness,
  sampleEntries,
  sampleFileContent,
} from './FilesView.test-harness'

describe('FilesView browsing', () => {
  beforeEach(resetFilesViewTestHarness)

  it('fetches the root directory through the typed runtime fs API on mount', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })
  })

  it('omits the default page header to maximize workspace height', async () => {
    renderFilesView({ projectName: 'My Awesome Project' })

    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Search files' })).toBeTruthy()
    })

    expect(screen.queryByText(/My Awesome Project/)).toBeNull()
    expect(screen.queryByText('Browse and preview project files')).toBeNull()
    expect(screen.queryByText('0 items')).toBeNull()
  })

  it('loads directory children when a directory is expanded', async () => {
    vi.mocked(fsReadDir).mockResolvedValueOnce(sampleEntries).mockResolvedValue([])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
    })
  })

  it('hides generated and vendor root folders by default with a full-access toggle', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(noisyRootEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    expect(screen.queryByText('.openforge-dev/')).toBeNull()
    expect(screen.queryByText('node_modules/')).toBeNull()
    expect(screen.queryByText('dist-electron/')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /Show generated folders \(3\)/ }))

    expect(screen.getByText('.openforge-dev/')).toBeTruthy()
    expect(screen.getByText('node_modules/')).toBeTruthy()
    expect(screen.getByText('dist-electron/')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /Hide generated folders/ }))

    expect(screen.queryByText('.openforge-dev/')).toBeNull()
    expect(screen.queryByText('node_modules/')).toBeNull()
    expect(screen.queryByText('dist-electron/')).toBeNull()
  })

  it('does not call fsReadDir when no project is selected', async () => {
    renderFilesView({ projectId: null })

    await waitFor(() => {
      expect(screen.getByText(/Select a project to browse files/)).toBeTruthy()
    })
    expect(fsReadDir).not.toHaveBeenCalled()
  })

  it('restores expanded directories and selected content after remounting the plugin view', async () => {
    const srcEntry = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const mainEntry = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([srcEntry])
      .mockResolvedValueOnce([mainEntry])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    const { unmount } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /main.ts/ }))
    await waitFor(() => {
      expect(screen.getByLabelText('File text content').textContent).toContain('Hello world')
    })

    unmount()
    vi.clearAllMocks()

    renderFilesView()

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getAllByText('main.ts').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('File text content').textContent).toContain('Hello world')
    expect(fsReadDir).not.toHaveBeenCalled()
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('loads a new project when projectId changes in an already-mounted plugin view', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'a.ts', path: 'a.ts' })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'b.ts', path: 'b.ts' })])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'project-b', path: null })
      expect(screen.getByText('b.ts')).toBeTruthy()
    })
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('keeps file browser state separate for each project', async () => {
    const projectASrc = makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })
    const projectAMain = makeFileEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false })
    const projectBDocs = makeFileEntry({ name: 'docs', path: 'docs', isDir: true, size: null })
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([projectASrc])
      .mockResolvedValueOnce([projectAMain])
      .mockResolvedValueOnce([projectBDocs])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })
    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    await waitFor(() => {
      expect(screen.getByText('docs/')).toBeTruthy()
    })
    expect(screen.queryByText('main.ts')).toBeNull()

    await rerender({ projectName: 'Project A', projectId: 'project-a' })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('main.ts')).toBeTruthy()
  })

  it('ignores stale root loads from a previous project', async () => {
    let resolveProjectA!: (entries: FileEntry[]) => void
    const projectARoot = new Promise<FileEntry[]>((resolve) => {
      resolveProjectA = resolve
    })
    vi.mocked(fsReadDir)
      .mockReturnValueOnce(projectARoot)
      .mockResolvedValueOnce([makeFileEntry({ name: 'b.ts', path: 'b.ts' })])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(screen.getByText('b.ts')).toBeTruthy()
    })

    resolveProjectA([makeFileEntry({ name: 'a.ts', path: 'a.ts' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('b.ts')).toBeTruthy()
  })

  it('ignores an earlier root load after returning to the same project', async () => {
    let resolveEarlierProjectA!: (entries: FileEntry[]) => void
    const earlierProjectARoot = new Promise<FileEntry[]>((resolve) => {
      resolveEarlierProjectA = resolve
    })
    vi.mocked(fsReadDir)
      .mockReturnValueOnce(earlierProjectARoot)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeFileEntry({ name: 'fresh.ts', path: 'fresh.ts' })])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'project-a', path: null })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'project-b', path: null })
    })

    await rerender({ projectName: 'Project A', projectId: 'project-a' })
    await waitFor(() => {
      expect(screen.getByText('fresh.ts')).toBeTruthy()
    })

    resolveEarlierProjectA([makeFileEntry({ name: 'stale.ts', path: 'stale.ts' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('stale.ts')).toBeNull()
    expect(screen.getByText('fresh.ts')).toBeTruthy()
  })
})
