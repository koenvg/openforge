import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_VIEW_ID,
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'

const {
  PluginSlotTestView,
  TaskDetailView,
  commandHeld,
  enabledPluginIds,
  installedPlugins,
  registerRenderableContributionComponent,
  runtimeContributionSources,
  taskActiveView,
  taskRuntimeInfo,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView navigation', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('hides Review toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('review')).toBeNull()
    })
  })

  it('renders plugin task pane tab buttons from enabled manifests', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(
      new Map([
        [
          'plugin.task-pane',
          {
            manifest: {
              id: 'plugin.task-pane',
              name: 'Task Pane Plugin',
              version: '1.0.0',
              apiVersion: 1,
              description: 'Adds a task tab',
              permissions: [],
              frontend: 'index.js',
              backend: null,
            },
            state: 'installed',
            error: null,
          },
        ],
      ]),
    )
    enabledPluginIds.set(new Set(['plugin.task-pane']))
    runtimeContributionSources.set(
      new Map([['plugin.task-pane', { pluginId: 'plugin.task-pane', taskPaneTabs: [{ id: 'activity', title: 'Activity', icon: 'sparkles', order: 5 }] }]]),
    )
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.task-pane:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^activity\b/i })).toBeTruthy()
    })
  })

  it('foregrounds a plugin Task UI tab when navigation updates the active Task view', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())
    installedPlugins.set(
      new Map([
        [
          'plugin.task-pane',
          {
            manifest: {
              id: 'plugin.task-pane',
              name: 'Task Pane Plugin',
              version: '1.0.0',
              apiVersion: 1,
              description: 'Adds a task tab',
              permissions: [],
              frontend: 'index.js',
              backend: null,
            },
            state: 'installed',
            error: null,
          },
        ],
      ]),
    )
    enabledPluginIds.set(new Set(['plugin.task-pane']))
    runtimeContributionSources.set(
      new Map([['plugin.task-pane', { pluginId: 'plugin.task-pane', taskPaneTabs: [{ id: 'activity', title: 'Activity', order: 5 }] }]]),
    )
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.task-pane:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })
    taskActiveView.set(new Map([['T-42', 'plugin.task-pane:activity']]))

    await waitFor(() => {
      const slotHost = document.querySelector('[data-slot-type="taskPaneTabs"]')
      expect(slotHost?.getAttribute('data-slot-id')).toBe('plugin.task-pane:activity')
    })
  })

  it('uses namespaced task-pane tab ids to avoid collisions across plugins', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(
      new Map([
        [
          'plugin.a',
          {
            manifest: {
              id: 'plugin.a',
              name: 'Plugin A',
              version: '1.0.0',
              apiVersion: 1,
              description: 'Plugin A tab',
              permissions: [],
              frontend: 'index.js',
              backend: null,
            },
            state: 'installed',
            error: null,
          },
        ],
        [
          'plugin.b',
          {
            manifest: {
              id: 'plugin.b',
              name: 'Plugin B',
              version: '1.0.0',
              apiVersion: 1,
              description: 'Plugin B tab',
              permissions: [],
              frontend: 'index.js',
              backend: null,
            },
            state: 'installed',
            error: null,
          },
        ],
      ]),
    )
    enabledPluginIds.set(new Set(['plugin.a', 'plugin.b']))
    runtimeContributionSources.set(
      new Map([
        ['plugin.a', { pluginId: 'plugin.a', taskPaneTabs: [{ id: 'activity', title: 'Activity A', order: 1 }] }],
        ['plugin.b', { pluginId: 'plugin.b', taskPaneTabs: [{ id: 'activity', title: 'Activity B', order: 2 }] }],
      ]),
    )
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.a:activity', PluginSlotTestView)
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.b:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Activity A' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Activity B' })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Activity B' }))

    await waitFor(() => {
      const slotHost = document.querySelector('[data-slot-type="taskPaneTabs"]')
      expect(slotHost?.getAttribute('data-slot-id')).toBe('plugin.b:activity')
    })

    expect(get(taskActiveView).get('T-42')).toBe('plugin.b:activity')

    commandHeld.set(true)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Activity A/ }).textContent).toContain('⌘3')
      expect(screen.getByRole('button', { name: /^Activity B/ }).textContent).toContain('⌘4')
    })

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Activity A/ }).getAttribute('aria-pressed')).toBe('true')
    })

    runtimeContributionSources.set(
      new Map([
        ['plugin.a', { pluginId: 'plugin.a', taskPaneTabs: [{ id: 'activity', title: 'Activity A', order: 2 }] }],
        ['plugin.b', { pluginId: 'plugin.b', taskPaneTabs: [{ id: 'activity', title: 'Activity B', order: 1 }] }],
      ]),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Activity B/ }).textContent).toContain('⌘3')
      expect(screen.getByRole('button', { name: /^Activity A/ }).textContent).toContain('⌘4')
    })

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Activity B/ }).getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('activates the terminal pane through view state when the terminal toggle is clicked', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())

    installedPlugins.set(
      new Map([
        [
          'com.openforge.terminal',
          {
            manifest: {
              id: 'com.openforge.terminal',
              name: 'Terminal',
              version: '1.0.0',
              apiVersion: 1,
              description: 'Terminal plugin',
              permissions: [],
              frontend: 'index.js',
              backend: null,
            },
            state: 'installed',
            error: null,
          },
        ],
      ]),
    )
    enabledPluginIds.set(new Set(['com.openforge.terminal']))
    runtimeContributionSources.set(
      new Map([
        ['com.openforge.terminal', { pluginId: 'com.openforge.terminal', taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 1 }] }],
      ]),
    )
    registerRenderableContributionComponent('taskPaneTabs', 'com.openforge.terminal:terminal', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('false')
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      const slotHost = document.querySelector('[data-slot-type="taskPaneTabs"]')
      expect(get(taskActiveView).get('T-42')).toBe('com.openforge.terminal:terminal')
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('false')
      expect(slotHost?.getAttribute('data-slot-id')).toBe('com.openforge.terminal:terminal')
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
    })
  })

  it('renders three tab buttons when worktree exists', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy()
      expect(screen.getByText('review')).toBeTruthy()
      expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy()
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('terminal tab hidden when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
    })
  })

  it('shows worktree-backed tab buttons when runtime workspace info arrives after initial load', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
    })

    taskRuntimeInfo.set(new Map([['T-42', { workspacePath: '/path/to/worktree' }]]))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^review\b/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy()
    })
  })

  it('selecting the terminal tab activates the terminal pane', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /shell 1/i })).toBeTruthy()
      expect(get(taskActiveView).get(baseTask.id)).toBe(TERMINAL_VIEW_ID)
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('activates shell terminal through the shared terminal pool', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { acquire } = await import('../../lib/terminalPool')
    const acquireMock = vi.mocked(acquire)
    acquireMock.mockClear()
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      expect(acquireMock).toHaveBeenCalledWith(`${baseTask.id}-shell-0`)
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('terminal tab becomes active (aria-pressed) when terminal tab clicked', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })
})
