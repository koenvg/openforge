import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
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

import TaskFilesView from './TaskFilesView.svelte'
import { fileBrowserStates, pendingFileReveal } from './lib/stores'

const taskReadDir = vi.fn()
const taskReadFile = vi.fn()
const taskSearchFiles = vi.fn()
const projectReadDir = vi.fn()
const projectReadFile = vi.fn()
const projectSearchFiles = vi.fn()

const context: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.file-viewer',
  projectId: 'project-a',
  taskId: 'task-a',
}

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: {
      readDir: projectReadDir,
      readFile: projectReadFile,
      searchFiles: projectSearchFiles,
      task: {
        readDir: taskReadDir,
        readFile: taskReadFile,
        searchFiles: taskSearchFiles,
      },
    },
    system: { openUrl: vi.fn() },
  } as unknown as FrontendOpenForgeAPI
}

function renderTaskFilesView() {
  return render(TaskFilesView, {
    props: {
      api: makeApi(),
      context,
      taskId: 'task-a',
      projectId: 'project-a',
      projectName: 'Project A',
    },
  })
}

describe('TaskFilesView', () => {
  beforeEach(() => {
    cleanup()
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    vi.clearAllMocks()
    taskReadDir.mockResolvedValue([])
    taskReadFile.mockResolvedValue({ type: 'text', content: 'task file', mimeType: null, size: 9 })
    taskSearchFiles.mockResolvedValue([])
    projectReadDir.mockResolvedValue([])
    projectReadFile.mockResolvedValue({ type: 'text', content: 'project file', mimeType: null, size: 12 })
    projectSearchFiles.mockResolvedValue([])
  })

  it('browses the task live worktree without reading project files', async () => {
    const entries: FileEntry[] = [{
      name: 'README.md',
      path: 'README.md',
      isDir: false,
      size: 9,
      modifiedAt: null,
    }]
    taskReadDir.mockResolvedValue(entries)

    renderTaskFilesView()

    expect(screen.getByText('Loading live worktree files…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())
    expect(taskReadDir).toHaveBeenCalledWith({ taskId: 'task-a', path: null })
    expect(projectReadDir).not.toHaveBeenCalled()
  })

  it('shows the task workspace error without falling back to project content', async () => {
    taskReadDir.mockRejectedValue(new Error('Task workspace is unavailable'))
    projectReadDir.mockResolvedValue([{
      name: 'PROJECT_ONLY.md',
      path: 'PROJECT_ONLY.md',
      isDir: false,
      size: 1,
      modifiedAt: null,
    }])

    renderTaskFilesView()

    await waitFor(() => expect(screen.getByText('Failed to load live worktree')).toBeTruthy())
    expect(screen.getByText('Task workspace is unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry loading live worktree' })).toBeTruthy()
    expect(screen.queryByText('PROJECT_ONLY.md')).toBeNull()
    expect(projectReadDir).not.toHaveBeenCalled()
  })
})
