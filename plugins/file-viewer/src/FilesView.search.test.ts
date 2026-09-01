import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fsReadDir,
  fsReadFile,
  fsSearchFiles,
  renderFilesView,
  resetFilesViewTestHarness,
  sampleEntries,
} from './FilesView.test-harness'

describe('FilesView search behavior', () => {
  beforeEach(resetFilesViewTestHarness)

  it('searches project files through the typed runtime fs API when a query is typed', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'stores' },
    })

    await waitFor(() => {
      expect(fsSearchFiles).toHaveBeenCalledWith({ projectId: 'test-project-id', query: 'stores', limit: 50 })
    })
  })

  it('ignores stale search results from the previous project', async () => {
    let resolveProjectASearch!: (paths: string[]) => void
    const projectASearch = new Promise<string[]>((resolve) => {
      resolveProjectASearch = resolve
    })
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles)
      .mockReturnValueOnce(projectASearch)
      .mockResolvedValueOnce(['src/project-b.ts'])

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'project' },
    })
    await waitFor(() => {
      expect(fsSearchFiles).toHaveBeenCalledWith({ projectId: 'project-a', query: 'project', limit: 50 })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'project' },
    })
    await waitFor(() => {
      expect(screen.getByText('project-b.ts')).toBeTruthy()
    })

    resolveProjectASearch(['src/project-a.ts'])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('project-a.ts')).toBeNull()
    expect(screen.getByText('project-b.ts')).toBeTruthy()
  })

  it('renders matching files as a nested tree with ancestor directories', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles).mockResolvedValue(['src/lib/stores.ts'])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'stores' },
    })

    await waitFor(() => {
      expect(screen.getByText('stores.ts')).toBeTruthy()
      expect(screen.getByText('lib/')).toBeTruthy()
    })
  })

  it('previews a search result through the typed fs API when it is selected', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles).mockResolvedValue(['src/lib/stores.ts'])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'stores' },
    })

    await waitFor(() => {
      expect(screen.getByText('stores.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /stores\.ts/ }))

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/lib/stores.ts' })
    })
  })

  it('shows an empty state when no files match the query', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles).mockResolvedValue([])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'nomatch' },
    })

    await waitFor(() => {
      expect(screen.getByText('No files match your search')).toBeTruthy()
    })
  })

  it('restores the browse tree when the search is cleared', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles).mockResolvedValue(['src/lib/stores.ts'])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    const searchbox = screen.getByRole('searchbox', { name: 'Search files' })
    await fireEvent.input(searchbox, { target: { value: 'stores' } })

    await waitFor(() => {
      expect(screen.getByText('stores.ts')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    await waitFor(() => {
      expect(screen.queryByText('stores.ts')).toBeNull()
      expect(screen.getByText('README.md')).toBeTruthy()
      expect(screen.getByText('src/')).toBeTruthy()
    })
  })

  it('surfaces a retryable error when the search fails', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsSearchFiles)
      .mockRejectedValueOnce(new Error('search index unavailable'))
      .mockResolvedValueOnce(['src/lib/stores.ts'])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'stores' },
    })

    await waitFor(() => {
      expect(screen.getByText('search index unavailable')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry file search' }))

    await waitFor(() => {
      expect(screen.getByText('stores.ts')).toBeTruthy()
    })
  })
})
