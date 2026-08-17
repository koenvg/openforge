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
  secondaryTask,
} from './TaskDetailView.testUtils'
import type { Task } from './TaskDetailView.testUtils'

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
  tasks,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView — tab navigation and state preservation', () => {
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

    installedPlugins.set(new Map([[
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
    ]]))
    enabledPluginIds.set(new Set(['plugin.task-pane']))
    runtimeContributionSources.set(new Map([[
      'plugin.task-pane',
      { pluginId: 'plugin.task-pane', taskPaneTabs: [{ id: 'activity', title: 'Activity', icon: 'sparkles', order: 5 }] },
    ]]))
    registerRenderableContributionComponent('taskPaneTabs', 'plugin.task-pane:activity', PluginSlotTestView)

    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^activity\b/i })).toBeTruthy()
    })
  })

  it('foregrounds a plugin Task UI tab when navigation updates the active Task view', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())
    installedPlugins.set(new Map([['plugin.task-pane', {
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
    }]]))
    enabledPluginIds.set(new Set(['plugin.task-pane']))
    runtimeContributionSources.set(new Map([[
      'plugin.task-pane',
      { pluginId: 'plugin.task-pane', taskPaneTabs: [{ id: 'activity', title: 'Activity', order: 5 }] },
    ]]))
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

    installedPlugins.set(new Map([
      ['plugin.a', {
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
      }],
      ['plugin.b', {
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
      }],
    ]))
    enabledPluginIds.set(new Set(['plugin.a', 'plugin.b']))
    runtimeContributionSources.set(new Map([
      ['plugin.a', { pluginId: 'plugin.a', taskPaneTabs: [{ id: 'activity', title: 'Activity A', order: 1 }] }],
      ['plugin.b', { pluginId: 'plugin.b', taskPaneTabs: [{ id: 'activity', title: 'Activity B', order: 2 }] }],
    ]))
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

    runtimeContributionSources.set(new Map([
      ['plugin.a', { pluginId: 'plugin.a', taskPaneTabs: [{ id: 'activity', title: 'Activity A', order: 2 }] }],
      ['plugin.b', { pluginId: 'plugin.b', taskPaneTabs: [{ id: 'activity', title: 'Activity B', order: 1 }] }],
    ]))

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

    installedPlugins.set(new Map([[
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
    ]]))
    enabledPluginIds.set(new Set(['com.openforge.terminal']))
    runtimeContributionSources.set(new Map([[
      'com.openforge.terminal',
      { pluginId: 'com.openforge.terminal', taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 1 }] },
    ]]))
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

    taskRuntimeInfo.set(new Map([[
      'T-42',
      { workspacePath: '/path/to/worktree' },
    ]]))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^review\b/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy()
    })
  })

  it('preserves the runtime workspace and active terminal tab when workspace lookup fails', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockRejectedValue(new Error('workspace lookup failed'))
    taskRuntimeInfo.set(new Map([[
      'T-42',
      { workspacePath: '/path/to/worktree' },
    ]]))
    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => expect(vi.mocked(getTaskWorkspace)).toHaveBeenCalledWith('T-42'))
    await new Promise(resolve => setTimeout(resolve, 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('false')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘3 switches to terminal tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
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

  it('Cmd+1 switches from an active terminal pane to agent without selecting a shell tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { focusTerminal } = await import('../../lib/terminalPool')
    const { createTerminalShortcutController } = await import('../../lib/terminalShortcutController')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    const switchToTab = vi.fn()
    const terminalShortcuts = createTerminalShortcutController()
    terminalShortcuts.terminalTabsRef = {
      addTab: vi.fn(),
      closeActiveTab: vi.fn().mockResolvedValue(undefined),
      focusActiveTab: vi.fn(),
      switchToTab,
    }
    const unregisterTerminalShortcuts = terminalShortcuts.registerWindowKeydown()

    try {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

      await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

      await waitFor(() => {
        expect(get(taskActiveView).get(baseTask.id)).toBe(TERMINAL_VIEW_ID)
      })

      vi.mocked(focusTerminal).mockClear()
      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
        expect(get(taskActiveView).get(baseTask.id)).toBe('agent')
      })
      expect(switchToTab).not.toHaveBeenCalled()
      expect(vi.mocked(focusTerminal)).not.toHaveBeenCalled()
    } finally {
      unregisterTerminalShortcuts()
      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    }
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

  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      taskActiveView.set(new Map())
    })

    it('l key switches to review mode when worktree exists', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')

      await fireEvent.keyDown(window, { key: 'l' })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('h key switches back to agent mode from review', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: 'l' })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
      })

      await fireEvent.keyDown(window, { key: 'h' })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('h and l keys are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      // With no worktree the view tabs do not render; the view stays on agent
      expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()

      await fireEvent.keyDown(window, { key: 'l' })
      expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()
    })

    it('h and l keys are ignored when modifier keys are held', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      const agentBtn = screen.getByRole('button', { name: /^agent\b/i })

      await fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
      expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

      await fireEvent.keyDown(window, { key: 'l', metaKey: true })
      expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

      await fireEvent.keyDown(window, { key: 'l', altKey: true })
      expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+2 switches to review mode when worktree exists', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+1 switches back to agent mode from review', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
      })

      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Cmd+1/2 work even when an input element is focused', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      const input = document.createElement('input')
      document.body.appendChild(input)

      try {
        input.focus()

        await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
        })

        await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
        })
      } finally {
        document.body.removeChild(input)
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      }
    })

    it('Cmd+1/2 are ignored when no worktree exists', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      // No worktree means no view tabs are rendered
      expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
      expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()
    })

    it('⌘3 ignored when no worktree', async () => {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      // No worktree means no view tabs are rendered
      expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()

      await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true, shiftKey: false })

      expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
    })

    it('shows shortcut hints on view toggle buttons when CMD is held', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      commandHeld.set(true)

      await waitFor(() => {
        const agentBtn = screen.getByRole('button', { name: /^agent\b/i }).closest('button')
        const reviewBtn = screen.getByText('review').closest('button')
        const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
        expect(agentBtn?.textContent).toContain('⌘1')
        expect(reviewBtn?.textContent).toContain('⌘2')
        expect(terminalBtn?.textContent).toContain('⌘3')
      })

      commandHeld.set(false)
      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('hides shortcut hints on view toggle buttons when CMD is not held', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => {
        expect(screen.getByText('review')).toBeTruthy()
      })

      commandHeld.set(false)

      await waitFor(() => {
        const agentBtn = screen.getByRole('button', { name: /^agent\b/i }).closest('button')
        const reviewBtn = screen.getByText('review').closest('button')
        const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
        expect(agentBtn?.textContent).not.toContain('⌘1')
        expect(reviewBtn?.textContent).not.toContain('⌘2')
        expect(terminalBtn?.textContent).not.toContain('⌘3')
      })

      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    })

    it('Escape triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
      vi.mocked(resetToBoard).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      await fireEvent.keyDown(window, { key: 'Escape' })

      expect(resetToBoard).toHaveBeenCalled()
    })

    it('does not navigate back before an open modal handles Escape', async () => {
      const { resetToBoard } = await import('../../lib/router.svelte')
      vi.mocked(resetToBoard).mockClear()
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

      const modal = document.createElement('div')
      modal.setAttribute('role', 'dialog')
      modal.setAttribute('aria-modal', 'true')
      modal.tabIndex = -1
      modal.addEventListener('keydown', (event) => {
        event.stopPropagation()
      })
      document.body.appendChild(modal)

      try {
        await fireEvent.keyDown(modal, { key: 'Escape' })
        expect(resetToBoard).not.toHaveBeenCalled()
      } finally {
        modal.remove()
      }
    })

     it('q triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
       vi.mocked(resetToBoard).mockClear()
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await fireEvent.keyDown(window, { key: 'q' })

       expect(resetToBoard).toHaveBeenCalled()
     })
   })

  describe('active view persistence', () => {
     beforeEach(() => {
       taskActiveView.set(new Map())
     })

     it('l key writes review to taskActiveView store for the task', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'l' })

       await waitFor(() => {
         expect(get(taskActiveView).get('T-42')).toBe('review')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('h key writes agent to taskActiveView store for the task', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       taskActiveView.set(new Map([['T-42', 'review']]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

       await fireEvent.keyDown(window, { key: 'h' })

       await waitFor(() => {
         expect(get(taskActiveView).get('T-42')).toBe('agent')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('restores legacy code mode from taskActiveView as the agent tab', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       taskActiveView.set(new Map([['T-42', 'code']]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('restores terminal mode from taskActiveView when task is rendered', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
       render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
       })

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('remounts the review pane when switching tasks while review is active', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       const { createDiffLoader } = await import('../../lib/useDiffLoader.svelte')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
       const firstCleanup = vi.fn()
       const secondCleanup = vi.fn()
       const makeLoader = (cleanup: () => void) => ({
         get isLoading() { return false },
         get error() { return null },
         get prComments() { return [] },
         get linkedPr() { return null },
         get commits() { return [] },
         get selectedCommitSha() { return null },
         loadDiff: vi.fn().mockResolvedValue(undefined),
         loadCommits: vi.fn().mockResolvedValue(undefined),
         selectCommit: vi.fn().mockResolvedValue(undefined),
         refresh: vi.fn().mockResolvedValue(undefined),
         cleanup,
       })
       vi.mocked(createDiffLoader)
         .mockReturnValueOnce(makeLoader(() => firstCleanup()))
         .mockReturnValueOnce(makeLoader(() => secondCleanup()))
       taskActiveView.set(new Map([['T-42', 'review'], ['T-99', 'review']]))

       const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
       await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

       await rerender({ task: secondaryTask, onRunAction: mockOnRunAction })

       await waitFor(() => expect(firstCleanup).toHaveBeenCalled())
       expect(vi.mocked(createDiffLoader).mock.calls.at(-1)?.[0].getTaskId()).toBe('T-99')

       vi.mocked(getTaskWorkspace).mockResolvedValue(null)
     })

     it('active tab persists per task via taskActiveView store', async () => {
       const { getTaskWorkspace } = await import('../../lib/ipc')
       vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

       taskActiveView.set(new Map([['T-42', 'review']]))
       render(TaskDetailView, { props: { task: secondaryTask, onRunAction: mockOnRunAction } })

       await waitFor(() => {
         expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
         expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
       })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
      it('falls back to agent tab when stored tab is terminal but no worktree', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        // No worktree means no view tabs render; the active view falls back to agent
        await waitFor(() => {
          expect(screen.getByText('Initial Prompt')).toBeTruthy()
        })
        expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
      })
    })

  describe('workbench tab state preservation', () => {
    it('keeps the agent PTY component mounted while another tab is active', async () => {
      const { getTaskWorkspace } = await import('../../lib/ipc')
      const { acquire, detach } = await import('../../lib/terminalPool')
      vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo())
      vi.mocked(acquire).mockClear()
      vi.mocked(detach).mockClear()

      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-42'))

      await fireEvent.click(screen.getByRole('button', { name: /^review\b/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true'))

      expect(screen.getByTestId('agent-workbench').getAttribute('aria-hidden')).toBe('true')
      expect(vi.mocked(detach)).not.toHaveBeenCalled()

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
  })
})
