import { fireEvent, screen, waitFor } from '@testing-library/svelte'
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

describe('FilesView loading and error states', () => {
  beforeEach(resetFilesViewTestHarness)

  it('shows visible copy while the root directory is loading', () => {
    vi.mocked(fsReadDir).mockReturnValue(new Promise(() => {}))

    renderFilesView()

    expect(screen.getByText('Loading project files…')).toBeTruthy()
  })

  it('retries the root directory load from the root failure state', async () => {
    vi.mocked(fsReadDir)
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('Failed to load files')).toBeTruthy()
      expect(screen.getByText('Permission denied')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading project files' }))

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledTimes(2)
      expect(screen.getByText('README.md')).toBeTruthy()
    })
  })

  it('retries directory loading from a contextual directory failure state', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce(sampleEntries)
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce([makeFileEntry({ name: 'main.ts', path: 'src/main.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))

    await waitFor(() => {
      expect(screen.getByText('Unable to load directory src')).toBeTruthy()
      expect(screen.getByText('Permission denied')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading src directory' }))

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
      expect(screen.getByText('main.ts')).toBeTruthy()
    })
  })

  it('shows visible copy while selected file content is loading', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsReadFile).mockReturnValue(new Promise(() => {}))

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    expect(await screen.findByText('Loading README.md…')).toBeTruthy()
  })

  it('keeps the tree return path available while the selected file is loading', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsReadFile).mockReturnValue(new Promise(() => {}))

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'README.md preview pane' }))
    })
    expect(screen.getByRole('button', { name: /Return focus to selected file in tree/ })).toBeTruthy()
  })

  it('retries selected file loading from the file failure state', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)
    vi.mocked(fsReadFile)
      .mockRejectedValueOnce(new Error('File not found'))
      .mockResolvedValueOnce(sampleFileContent)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    await waitFor(() => {
      expect(screen.getByText('Unable to load file')).toBeTruthy()
      expect(screen.getByText('File not found')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading README.md' }))

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Hello world')).toBeTruthy()
    })
  })
})
