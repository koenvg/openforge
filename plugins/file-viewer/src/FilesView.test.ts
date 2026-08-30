import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'

vi.mock('@lucide/svelte', () => ({
  Archive: vi.fn(() => ({})),
  CircleAlert: vi.fn(() => ({})),
  FileQuestion: vi.fn(() => ({})),
  FolderCog: vi.fn(() => ({})),
  FileText: vi.fn(() => ({})),
  Folder: vi.fn(() => ({})),
  FolderOpen: vi.fn(() => ({})),
  Search: vi.fn(() => ({})),
  TriangleAlert: vi.fn(() => ({})),
  X: vi.fn(() => ({})),
}))

import FilesView from './FilesView.svelte'
import { get } from 'svelte/store'
import { activeProjectId, fileBrowserStates, pendingFileReveal } from './lib/stores'

const fsReadDir = vi.fn()
const fsReadFile = vi.fn()
const fsSearchFiles = vi.fn()
const openUrl = vi.fn()

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: { readDir: fsReadDir, readFile: fsReadFile, searchFiles: fsSearchFiles },
    system: { openUrl },
  } as unknown as FrontendOpenForgeAPI
}

const runtimeContext: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.file-viewer',
  projectId: 'test-project-id',
}

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: 'file.ts',
    path: 'file.ts',
    isDir: false,
    size: 512,
    modifiedAt: null,
    ...overrides,
  }
}

const sampleEntries: FileEntry[] = [
  makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
  makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1024 }),
]

const noisyRootEntries: FileEntry[] = [
  makeFileEntry({ name: '.openforge-dev', path: '.openforge-dev', isDir: true, size: null }),
  makeFileEntry({ name: 'node_modules', path: 'node_modules', isDir: true, size: null }),
  makeFileEntry({ name: 'dist-electron', path: 'dist-electron', isDir: true, size: null }),
  makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
  makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1024 }),
]

const sampleFileContent: FileContent = {
  type: 'text',
  content: 'Hello world',
  mimeType: null,
  size: 11,
}

function renderFilesView(props: { projectName?: string; projectId?: string | null; api?: FrontendOpenForgeAPI } = {}) {
  return render(FilesView, {
    props: {
      api: props.api ?? makeApi(),
      context: runtimeContext,
      projectName: props.projectName ?? 'My Project',
      projectId: props.projectId === undefined ? 'test-project-id' : props.projectId,
    },
  })
}

describe('plugin FilesView', () => {
  beforeEach(() => {
    cleanup()
    activeProjectId.set(null)
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
    vi.mocked(fsSearchFiles).mockResolvedValue([])
  })

  it('fetches the root directory through the typed runtime fs API on mount', async () => {
    vi.mocked(fsReadDir).mockResolvedValue(sampleEntries)

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })
  })

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

  it('moves focus to the preview pane after revealing a file', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    pendingFileReveal.set('README.md')

    await waitFor(() => {
      const previewPane = screen.getByRole('region', { name: 'README.md preview pane' })
      expect(document.activeElement).toBe(previewPane)
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

  it('shows hidden root folders automatically when revealing a file inside one', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce(noisyRootEntries)
      .mockResolvedValueOnce([makeFileEntry({ name: 'log.txt', path: '.openforge-dev/log.txt' })])

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('src/')).toBeTruthy()
    })

    expect(screen.queryByText('.openforge-dev/')).toBeNull()

    pendingFileReveal.set('.openforge-dev/log.txt')

    await waitFor(() => {
      expect(screen.getByText('.openforge-dev/')).toBeTruthy()
      expect(screen.getByText('log.txt')).toBeTruthy()
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: '.openforge-dev/log.txt' })
    })
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

  it('expands parent directories and selects file for a pending reveal request', async () => {
    vi.mocked(fsReadDir)
      .mockResolvedValueOnce([makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'components', path: 'src/components', isDir: true, size: null })])
      .mockResolvedValueOnce([makeFileEntry({ name: 'Button.ts', path: 'src/components/Button.ts' })])

    renderFilesView()

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: null })
    })

    pendingFileReveal.set('src/components/Button.ts')

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

    pendingFileReveal.set('src/utils.ts')

    await waitFor(() => {
      expect(fsReadDir).not.toHaveBeenCalled()
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src/utils.ts' })
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

    pendingFileReveal.set('docs/guides/README.md')

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

  it('clears pendingFileReveal after processing', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([makeFileEntry({ name: 'README.md', path: 'README.md' })])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    pendingFileReveal.set('README.md')

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'README.md' })
    })

    await waitFor(() => {
      expect(get(pendingFileReveal)).toBeNull()
    })
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

    pendingFileReveal.set('README.md')
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

    pendingFileReveal.set('src/secret.ts')

    await waitFor(() => {
      expect(fsReadDir).toHaveBeenCalledWith({ projectId: 'test-project-id', path: 'src' })
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(get(pendingFileReveal)).toBe('src/secret.ts')
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

    pendingFileReveal.set('src/secret.ts')

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

    pendingFileReveal.set('some/file.ts')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fsReadDir).toHaveBeenCalledTimes(1)
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  describe('file search', () => {
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
})
