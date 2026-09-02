import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
import { get } from 'svelte/store'
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
import { fileBrowserStates, pendingFileReveal, requestFileReveal } from './lib/stores'

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
    expect(screen.getByText('Live worktree')).toBeTruthy()
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

  it('selects a missing live-worktree target without treating its suffix as a path', async () => {
    taskReadDir
      .mockResolvedValueOnce([{
        name: 'docs',
        path: 'docs',
        isDir: true,
        size: null,
        modifiedAt: null,
      }])
      .mockResolvedValueOnce([])
    taskReadFile.mockRejectedValue(new Error('Live file does not exist'))

    renderTaskFilesView()
    await waitFor(() => expect(screen.getByText('docs/')).toBeTruthy())

    requestFileReveal('docs/MISSING.md', 'task:task-a', '?plain=1#expected-section')

    expect(await screen.findByText('Live file does not exist')).toBeTruthy()
    expect(taskReadFile).toHaveBeenCalledWith({ taskId: 'task-a', path: 'docs/MISSING.md' })
    expect(get(pendingFileReveal)).toBeNull()
    expect(get(fileBrowserStates).get('task:task-a')).toMatchObject({
      selectedPath: 'docs/MISSING.md',
      selectedSuffix: '?plain=1#expected-section',
    })
  })

  it('isolates pending reveals and stale file reads across task worktrees', async () => {
    const readme: FileEntry = {
      name: 'README.md',
      path: 'README.md',
      isDir: false,
      size: 20,
      modifiedAt: null,
    }
    let resolveTaskA!: (content: { type: 'text'; content: string; mimeType: null; size: number }) => void
    const taskARead = new Promise<{ type: 'text'; content: string; mimeType: null; size: number }>((resolve) => {
      resolveTaskA = resolve
    })
    taskReadDir.mockResolvedValue([readme])
    taskReadFile.mockImplementation(({ taskId }: { taskId: string; path: string }) => (
      taskId === 'task-a'
        ? taskARead
        : Promise.resolve({ type: 'text', content: 'Task B live content', mimeType: null, size: 19 })
    ))
    const api = makeApi()
    const view = render(TaskFilesView, {
      props: { api, context, taskId: 'task-a' },
    })

    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())
    requestFileReveal('README.md', 'task:task-a', '?plain=1#task-a')
    await waitFor(() => expect(taskReadFile).toHaveBeenCalledWith({ taskId: 'task-a', path: 'README.md' }))

    const taskBContext = { ...context, taskId: 'task-b' }
    await view.rerender({ api, context: taskBContext, taskId: 'task-b' })
    await waitFor(() => expect(taskReadDir).toHaveBeenCalledWith({ taskId: 'task-b', path: null }))
    requestFileReveal('README.md', 'task:task-b', '?plain=1#task-b')

    expect(await screen.findByText('Task B live content')).toBeTruthy()
    expect(taskReadFile).toHaveBeenCalledWith({ taskId: 'task-b', path: 'README.md' })
    expect(get(pendingFileReveal)).toBeNull()
    expect(get(fileBrowserStates).get('task:task-b')).toMatchObject({
      selectedPath: 'README.md',
      selectedSuffix: '?plain=1#task-b',
      fileContent: { content: 'Task B live content' },
    })

    resolveTaskA({ type: 'text', content: 'Stale Task A content', mimeType: null, size: 20 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.queryByText('Stale Task A content')).toBeNull()
    expect(screen.getByText('Task B live content')).toBeTruthy()
    expect(get(fileBrowserStates).get('task:task-a')).toMatchObject({
      selectedPath: 'README.md',
      selectedSuffix: '?plain=1#task-a',
      fileContent: null,
    })
  })
})
