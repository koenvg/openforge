import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { MarkdownRepositoryLinkTarget } from '@openforge-app/plugin-sdk/markdown'
import type {
  CommandRegistration,
  FrontendOpenForgeAPI,
  FrontendPluginContext,
  OpenForgeContextSnapshot,
} from '@openforge-app/plugin-sdk/frontend'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelfReviewRepositoryPreview from './SelfReviewRepositoryPreview.svelte'
import { revealFileInTaskFiles } from '../../lib/fileViewerPlugin'
import {
  applyRuntimeSnapshotContributions,
  clearPluginRuntimeContributions,
} from '../../lib/plugin/pluginRuntimeContributions'
import plugin, { FILE_VIEWER_REVEAL_FILE_COMMAND_ID } from '../../../plugins/file-viewer/src/index'
import TaskFilesView from '../../../plugins/file-viewer/src/TaskFilesView.svelte'
import { fileBrowserStates, pendingFileReveal } from '../../../plugins/file-viewer/src/lib/stores'

const pluginId = 'com.openforge.file-viewer'
const projectId = 'project-1'

function fileEntry(path: string): FileEntry {
  return {
    name: path,
    path,
    isDir: false,
    size: 20,
    modifiedAt: null,
  }
}

function contextFor(taskId: string): OpenForgeContextSnapshot {
  return { pluginId, projectId, taskId }
}

async function activateFileViewerCommand(api: FrontendOpenForgeAPI): Promise<void> {
  const commands: CommandRegistration[] = []
  const context = {
    pluginId,
    apiVersion: 1,
    packageMetadata: {
      id: pluginId,
      apiVersion: 1,
      displayName: 'File Viewer',
      description: 'Browse files',
      icon: 'folder-open',
      frontend: './dist/frontend.js',
      requires: ['commands'],
    },
    subscriptions: { add: vi.fn() },
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as FrontendPluginContext

  vi.mocked(api.commands.register).mockImplementation((registration) => {
    commands.push(registration)
    return { dispose: vi.fn() }
  })
  await plugin.activate(api, context)

  const revealCommand = commands.find((command) => command.id === FILE_VIEWER_REVEAL_FILE_COMMAND_ID)
  if (!revealCommand) throw new Error('File Viewer did not register revealFile')

  await applyRuntimeSnapshotContributions(pluginId, {
    pluginId,
    projectId,
    views: [],
    viewReplacements: [],
    taskPaneTabs: [],
    taskUISections: [],
    reviewRowActions: [],
    settingsSections: [],
    injectionPoints: [],
    taskStartPrefixProviders: [],
    commands: [{
      id: revealCommand.id,
      qualifiedId: `${pluginId}:${revealCommand.id}`,
      pluginId,
      projectId,
      title: revealCommand.title,
      discoverable: revealCommand.discoverable,
      input: revealCommand.input,
      output: revealCommand.output,
      handler: (payload) => revealCommand.handler(payload, {
        taskId: null,
        projectId,
        source: 'plugin',
      }),
    }],
    eventListeners: [],
    backendMethods: [],
    backgroundServices: [],
  })
}

function makeApi() {
  const navigation = vi.fn().mockResolvedValue({
    activeProjectId: projectId,
    currentView: 'board',
    selectedTaskId: null,
  })
  const readDir = vi.fn(async ({ taskId }: { taskId: string; path: string | null }) => (
    taskId === 'task-a' ? [fileEntry('A.md')] : [fileEntry('B.md')]
  ))
  const readFile = vi.fn(async ({ taskId }: { taskId: string; path: string }) => ({
    type: 'text' as const,
    content: taskId === 'task-a' ? '# Live A' : '# Live B',
    mimeType: 'text/markdown',
    size: 20,
  }))
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskPane: { registerTab: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(), invokeGlobal: vi.fn() },
    navigation: { navigate: navigation },
    fs: {
      task: {
        readDir,
        readFile,
        searchFiles: vi.fn().mockResolvedValue([]),
      },
    },
    system: { openUrl: vi.fn() },
  } as unknown as FrontendOpenForgeAPI

  return { api, navigation, readFile }
}

describe('Review preview to task Files integration', () => {
  beforeEach(() => {
    fileBrowserStates.set(new Map())
    pendingFileReveal.set(null)
    clearPluginRuntimeContributions(pluginId)
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    clearPluginRuntimeContributions(pluginId)
  })

  it('navigates each Review preview to its own live task Files content and preserves historical Review content', async () => {
    const { api, navigation, readFile } = makeApi()
    await activateFileViewerCommand(api)

    render(TaskFilesView, { props: { api, context: contextFor('task-a'), taskId: 'task-a' } })
    render(TaskFilesView, { props: { api, context: contextFor('task-b'), taskId: 'task-b' } })
    render(SelfReviewRepositoryPreview, {
      props: {
        target: { repositoryPath: 'A.md', suffix: '?plain=1#live-a' },
        selectedCommitSha: 'historical-a',
        fetchContent: vi.fn().mockResolvedValue('# Historical A'),
        onOpenRepositoryPath: vi.fn(),
        onOpenInFiles: (target: MarkdownRepositoryLinkTarget) => revealFileInTaskFiles('task-a', target.repositoryPath, target.suffix),
        onClose: vi.fn(),
      },
    })
    render(SelfReviewRepositoryPreview, {
      props: {
        target: { repositoryPath: 'B.md', suffix: '?plain=1#live-b' },
        selectedCommitSha: 'historical-b',
        fetchContent: vi.fn().mockResolvedValue('# Historical B'),
        onOpenRepositoryPath: vi.fn(),
        onOpenInFiles: (target: MarkdownRepositoryLinkTarget) => revealFileInTaskFiles('task-b', target.repositoryPath, target.suffix),
        onClose: vi.fn(),
      },
    })

    expect(await screen.findByRole('heading', { name: 'Historical A' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Historical B' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Open A.md in Files' }))
    expect(await screen.findByRole('heading', { name: 'Live A' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Open B.md in Files' }))
    expect(await screen.findByRole('heading', { name: 'Live B' })).toBeTruthy()

    expect(navigation).toHaveBeenNthCalledWith(1, { taskId: 'task-a', taskViewId: 'files' })
    expect(navigation).toHaveBeenNthCalledWith(2, { taskId: 'task-b', taskViewId: 'files' })
    expect(readFile).toHaveBeenCalledWith({ taskId: 'task-a', path: 'A.md' })
    expect(readFile).toHaveBeenCalledWith({ taskId: 'task-b', path: 'B.md' })
    expect(get(fileBrowserStates).get('task:task-a')).toMatchObject({
      selectedPath: 'A.md',
      selectedSuffix: '?plain=1#live-a',
    })
    expect(get(fileBrowserStates).get('task:task-b')).toMatchObject({
      selectedPath: 'B.md',
      selectedSuffix: '?plain=1#live-b',
    })
    expect(get(pendingFileReveal)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Historical A' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Historical B' })).toBeTruthy()
  })
})
