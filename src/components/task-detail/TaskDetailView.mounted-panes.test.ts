import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
  secondaryTask,
  terminalAttachmentDetach,
} from './TaskDetailView.testUtils'

const {
  PluginSlotTestView,
  TaskDetailView,
  enabledPluginIds,
  installedPlugins,
  registerRenderableContributionComponent,
  runtimeContributionSources,
  taskActiveView,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView mounted-pane behavior', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('remounts the review pane when switching tasks while review is active', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { createDiffLoader } = await import('../../lib/useDiffLoader.svelte')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()
    const makeLoader = (cleanup: () => void) => ({
      get isLoading() {
        return false
      },
      get error() {
        return null
      },
      get prComments() {
        return []
      },
      get linkedPr() {
        return null
      },
      get commits() {
        return []
      },
      get selectedCommitSha() {
        return null
      },
      loadDiff: vi.fn().mockResolvedValue(undefined),
      loadCommits: vi.fn().mockResolvedValue(undefined),
      selectCommit: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      cleanup,
    })
    vi.mocked(createDiffLoader)
      .mockReturnValueOnce(makeLoader(() => firstCleanup()))
      .mockReturnValueOnce(makeLoader(() => secondCleanup()))
    taskActiveView.set(
      new Map([
        ['T-42', 'review'],
        ['T-99', 'review'],
      ]),
    )

    const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

    await rerender({ task: secondaryTask, onRunAction: mockOnRunAction })

    await waitFor(() => expect(firstCleanup).toHaveBeenCalled())
    expect(vi.mocked(createDiffLoader).mock.calls.at(-1)?.[0].getTaskId()).toBe('T-99')

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('keeps the agent PTY component mounted while another tab is active', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { agentTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire } = agentTerminalSessions
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())
    vi.mocked(acquire).mockClear()
    terminalAttachmentDetach.mockClear()

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-42'))

    await fireEvent.click(screen.getByRole('button', { name: /^review\b/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true'))

    expect(screen.getByTestId('agent-workbench').getAttribute('aria-hidden')).toBe('true')
    expect(terminalAttachmentDetach).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: /^agent\b/i }))
    expect(screen.getByTestId('agent-workbench').getAttribute('aria-hidden')).toBe('false')
    expect(vi.mocked(acquire)).toHaveBeenCalledTimes(1)
  })

  it('keeps a visited plugin workbench mounted when returning to Agent', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const terminalTab = await screen.findByRole('button', { name: /^terminal\b/i })
    await fireEvent.click(terminalTab)
    const pluginWorkbench = await screen.findByTestId('plugin-workbench-com.openforge.terminal:terminal')

    await fireEvent.click(screen.getByRole('button', { name: /^agent\b/i }))

    expect(pluginWorkbench.getAttribute('aria-hidden')).toBe('true')
    expect(pluginWorkbench.isConnected).toBe(true)
  })

  it('shows a workspace-optional Files tab and pane when the task workspace is unavailable', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const pluginId = 'com.openforge.file-viewer'
    const filesViewId = `${pluginId}:files`
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    enabledPluginIds.update((ids) => new Set(ids).add(pluginId))
    installedPlugins.update((plugins) => new Map(plugins).set(pluginId, {
      manifest: {
        id: pluginId,
        name: 'File Viewer',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Browse Task files',
        permissions: [],
        frontend: 'index.js',
        backend: null,
      },
      state: 'installed',
      error: null,
    }))
    runtimeContributionSources.update((sources) => new Map(sources).set(pluginId, {
      pluginId,
      taskPaneTabs: [{
        id: 'files',
        title: 'Files',
        icon: 'folder-open',
        order: 20,
        requiresWorkspace: false,
      }],
    }))
    registerRenderableContributionComponent('taskPaneTabs', filesViewId, PluginSlotTestView)
    taskActiveView.set(new Map([[baseTask.id, filesViewId]]))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    const filesTab = await screen.findByRole('button', { name: /^files/i })
    await waitFor(() => expect(filesTab.getAttribute('aria-pressed')).toBe('true'))
    const filesWorkbench = await screen.findByTestId(`plugin-workbench-${filesViewId}`)
    expect(filesWorkbench.getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
  })
})
