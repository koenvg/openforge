import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'

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

import { get } from 'svelte/store'
import FilesView from './FilesView.svelte'
import { fileBrowserStates, pendingFileReveal, requestFileReveal } from './lib/stores'
import {
  projectWorkspaceIdentity,
  type FileBrowserWorkspaceSource,
} from './lib/workspaceSource'

const fsReadDir = vi.fn()
const fsReadFile = vi.fn()
const fsSearchFiles = vi.fn()
const openUrl = vi.fn()

const runtimeContext: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.file-viewer',
  projectId: 'test-project-id',
}

const sampleFileContent: FileContent = {
  type: 'text',
  content: 'Hello world',
  mimeType: null,
  size: 11,
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

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: { readDir: fsReadDir, readFile: fsReadFile, searchFiles: fsSearchFiles },
    system: { openUrl },
  } as unknown as FrontendOpenForgeAPI
}

function renderFilesView(props: {
  projectName?: string
  projectId?: string | null
  workspaceSource?: FileBrowserWorkspaceSource | null
  api?: FrontendOpenForgeAPI
} = {}) {
  return render(FilesView, {
    props: {
      api: props.api ?? makeApi(),
      context: runtimeContext,
      projectName: props.projectName ?? 'My Project',
      projectId: props.projectId === undefined ? 'test-project-id' : props.projectId,
      workspaceSource: props.workspaceSource,
    },
  })
}

describe('File Viewer workspace sources', () => {
  beforeEach(() => {
    cleanup()
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    vi.mocked(fsReadDir).mockResolvedValue([])
    vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
    vi.mocked(fsSearchFiles).mockResolvedValue([])
  })

  it('browses, searches, and previews through an explicit workspace source', async () => {
    const readDirectory = vi.fn().mockResolvedValue([
      makeFileEntry({ name: 'README.md', path: 'README.md' }),
    ])
    const readFile = vi.fn().mockResolvedValue(sampleFileContent)
    const searchFiles = vi.fn().mockResolvedValue(['README.md'])
    const workspaceSource: FileBrowserWorkspaceSource = {
      identity: 'fixture:workspace-a',
      readDirectory,
      readFile,
      searchFiles,
    }

    renderFilesView({ projectId: null, workspaceSource })

    await waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith(null)
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'readme' },
    })
    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith('readme', 50)
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))
    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith('README.md')
      expect(screen.getByText('Hello world')).toBeTruthy()
    })

    expect(fsReadDir).not.toHaveBeenCalled()
    expect(fsSearchFiles).not.toHaveBeenCalled()
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('restores each workspace search after switching away and back', async () => {
    vi.mocked(fsReadDir).mockResolvedValue([
      makeFileEntry({ name: 'README.md', path: 'README.md' }),
    ])
    vi.mocked(fsSearchFiles).mockImplementation(async ({ projectId }: { projectId: string }) => {
      return projectId === 'project-a' ? ['src/project-a.ts'] : ['src/project-b.ts']
    })

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    const searchbox = await screen.findByRole('searchbox', { name: 'Search files' })
    await fireEvent.input(searchbox, { target: { value: 'alpha' } })

    await waitFor(() => {
      expect(screen.getByText('project-a.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })
    const projectBSearchbox = await screen.findByRole('searchbox', { name: 'Search files' })
    expect((projectBSearchbox as HTMLInputElement).value).toBe('')
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'beta' },
    })

    await waitFor(() => {
      expect(screen.getByText('project-b.ts')).toBeTruthy()
    })

    await rerender({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect((screen.getByRole('searchbox', { name: 'Search files' }) as HTMLInputElement).value).toBe('alpha')
      expect(screen.getByText('project-a.ts')).toBeTruthy()
    })
    expect(screen.queryByText('project-b.ts')).toBeNull()
  })

  it('waits to process a project-targeted reveal until that project is active', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md' })
    vi.mocked(fsReadDir).mockResolvedValue([readmeEntry])

    requestFileReveal('README.md', projectWorkspaceIdentity('project-b'))
    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(fsReadFile).not.toHaveBeenCalled()

    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-b', path: 'README.md' })
      expect(get(pendingFileReveal)).toBeNull()
    })
  })

  it('does not let an older reveal clear a newer workspace request', async () => {
    const readmeEntry = makeFileEntry({ name: 'README.md', path: 'README.md' })
    let resolveProjectARead!: (content: FileContent) => void
    const projectARead = new Promise<FileContent>((resolve) => {
      resolveProjectARead = resolve
    })
    vi.mocked(fsReadDir).mockResolvedValue([readmeEntry])
    vi.mocked(fsReadFile)
      .mockReturnValueOnce(projectARead)
      .mockResolvedValueOnce({ ...sampleFileContent, content: 'Project B readme' })

    const { rerender } = renderFilesView({ projectName: 'Project A', projectId: 'project-a' })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })

    requestFileReveal('README.md', projectWorkspaceIdentity('project-a'))
    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-a', path: 'README.md' })
    })

    requestFileReveal('README.md', projectWorkspaceIdentity('project-b'))
    resolveProjectARead(sampleFileContent)

    await waitFor(() => {
      expect(get(pendingFileReveal)).toMatchObject({
        workspaceIdentity: projectWorkspaceIdentity('project-b'),
        path: 'README.md',
      })
    })

    await rerender({ projectName: 'Project B', projectId: 'project-b' })

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-b', path: 'README.md' })
      expect(screen.getByText('Project B readme')).toBeTruthy()
      expect(get(pendingFileReveal)).toBeNull()
    })
  })
})
