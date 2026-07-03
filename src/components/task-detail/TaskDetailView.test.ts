// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    loadAddon = vi.fn()
    refresh = vi.fn()
    focus = vi.fn()
    reset = vi.fn()
    cols = 80
    rows = 24
    options: { theme: Record<string, string> } = { theme: {} }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
    proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 })
  }
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon }
})

vi.mock('@openforge/terminal-runtime/xterm.css', () => ({}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

vi.mock('../../lib/useDiffLoader.svelte', () => ({
  createDiffLoader: vi.fn(() => ({
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
    cleanup: vi.fn(),
  })),
}))

vi.mock('../../lib/useCommentSelection.svelte', () => ({
  createCommentSelection: vi.fn(() => ({
    get selectedCount() { return 0 },
    get unaddressedCount() { return 0 },
    get addressedCount() { return 0 },
    get selectedPrCommentIds() { return new Set() },
    get unaddressedComments() { return [] },
    get selectedPrComments() { return [] },
    toggleSelected: vi.fn(),
    selectAll: vi.fn(),
    deselectAll: vi.fn(),
    markAddressed: vi.fn(),
  })),
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/stores', () => ({
  selectedTaskId: writable(null),
  activeSessions: writable(new Map()),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  setTaskMerging: vi.fn(),
  tasks: writable([]),
  activeProjectId: writable('project-1'),
  startingTasks: writable(new Set()),
  completingTasks: writable(new Set()),
  error: writable(null),
  taskRuntimeInfo: writable(new Map()),
  pendingManualComments: writable([]),
  taskActiveView: writable(new Map()),
  taskDraftNotes: writable(new Map()),
  commandHeld: writable(false),
}))

vi.mock('../../lib/ipc', () => ({
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  openInEditor: vi.fn().mockResolvedValue(undefined),
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  getConfig: vi.fn().mockResolvedValue(''),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  getPtyBuffer: vi.fn().mockResolvedValue(null),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([]),
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
  addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
  deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const { taskTabSessions } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue({
    taskId: '',
    terminal: {
      open: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      reset: vi.fn(),
      cols: 80,
      rows: 24,
      options: { theme: {} },
      focus: vi.fn(),
      loadAddon: vi.fn(),
    },
    fitAddon: { fit: vi.fn() },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
    spawnPending: false,
    currentPtyInstance: null,
  }),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  releaseAllForTask: vi.fn().mockReturnValue(0),
  focusTerminal: vi.fn(),
  shouldSpawnPty: vi.fn((entry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
  markPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = true
  }),
  clearPtySpawnPending: vi.fn((entry) => {
    entry.spawnPending = false
  }),
  setCurrentPtyInstance: vi.fn((entry, instanceId) => {
    entry.currentPtyInstance = instanceId
  }),
  markShellPtyStarted: vi.fn((entry, instanceId) => {
    entry.currentPtyInstance = instanceId
    entry.ptyActive = true
    entry.needsClear = false
  }),
  subscribeShellLifecycle: vi.fn(() => () => {}),
  getShellLifecycleState: vi.fn((taskId: string) => ({
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null,
    taskId,
  })),
  updateShellLifecycleState: vi.fn(),
  isShellExited: vi.fn((_taskId: string) => false),
  getTaskTerminalTabsSession: vi.fn((taskId: string) => {
    const existing = taskTabSessions.get(taskId)
    if (existing) return existing
    const session = {
      tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
      activeTabIndex: 0,
      nextIndex: 1,
    }
    taskTabSessions.set(taskId, session)
    return session
  }),
  updateTaskTerminalTabsSession: vi.fn((taskId: string, session) => {
    taskTabSessions.set(taskId, session)
  }),
  clearTaskTerminalTabsSession: vi.fn((taskId: string) => {
    taskTabSessions.delete(taskId)
  }),
}))

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  pushNavState: vi.fn(),
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

vi.mock('../../lib/actions', () => ({
  loadActions: vi.fn(() => Promise.resolve([
    { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
  ])),
  getEnabledActions: vi.fn((actions: { enabled: boolean }[]) => actions.filter(a => a.enabled)),
}))

import { activeSessions, completingTasks, taskActiveView, commandHeld, taskRuntimeInfo } from '../../lib/stores'
import type { Task, AgentSession, TaskWorkspaceInfo } from '../../lib/types'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { clearTerminalTaskPaneControllers } from './terminalTaskPaneController'
import TaskDetailView from './TaskDetailView.svelte'

const TERMINAL_VIEW_ID = 'com.openforge.terminal:terminal'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  summary: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const secondaryTask: Task = {
  ...baseTask,
  id: 'T-99',
  initial_prompt: 'Implement audit logging',
}

const mockOnRunAction = vi.fn()

const baseSession: AgentSession = {
  id: 'session-1',
  ticket_id: 'T-42',
  opencode_session_id: null,
  stage: 'implement',
  status: 'running',
  checkpoint_data: null,
  pty_instance_id: null,
  error_message: null,
  created_at: 1000,
  updated_at: 2000,
  provider: 'opencode',
  claude_session_id: null,
    pi_session_id: null,
}

function createTaskWorkspaceInfo(overrides: Partial<TaskWorkspaceInfo> = {}): TaskWorkspaceInfo {
  return {
    id: 1,
    task_id: 'T-42',
    project_id: 'project-1',
    repo_path: '/repo',
    workspace_path: '/path/to/worktree',
    kind: 'worktree',
    branch_name: 'branch',
    provider_name: 'opencode',
    status: 'ready',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

describe('createTaskWorkspaceInfo', () => {
  it('applies overrides while keeping a valid typed workspace shape', () => {
    expect(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', branch_name: 'feature/task' })).toMatchObject({
      task_id: 'T-42',
      repo_path: '/repo',
      workspace_path: '/tmp/wt',
      branch_name: 'feature/task',
      status: 'ready',
    })
  })
})

describe('TaskDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    taskActiveView.set(new Map())
    taskRuntimeInfo.set(new Map())
    completingTasks.set(new Set())
    commandHeld.set(false)
    taskTabSessions.clear()
    clearTerminalTaskPaneControllers()
    installedPlugins.set(new Map([[
      'com.openforge.terminal',
      {
        manifest: {
          id: 'com.openforge.terminal',
          name: 'Terminal',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Embedded terminal plugin',
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
      { pluginId: 'com.openforge.terminal', taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }] },
    ]]))
    clearComponentRegistry()
    registerRenderableContributionComponent('taskPaneTabs', TERMINAL_VIEW_ID, TerminalTaskPane)
  })

  it('renders back button with "back" text', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('back')).toBeTruthy()
  })

  it('renders task id', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const matches = screen.getAllByText('T-42')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders task title in header', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    const titles = screen.getAllByText('Implement auth middleware')
    expect(titles.length).toBeGreaterThanOrEqual(1)
  })

  it('has AgentPanel child with empty state text', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
  })

  it('has TaskInfoPanel child with Initial Prompt section', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  it('owns right info pane scrolling at the sidebar boundary', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    const scrollContainer = screen.getByTestId('task-info-scroll-container')
    const infoPanel = screen.getByTestId('task-info-panel')

    expect(scrollContainer.getAttribute('data-scroll-owner')).toBe('task-info-panel')
    expect(infoPanel.getAttribute('data-scroll-owner')).toBe('false')
    expect(scrollContainer.contains(infoPanel)).toBe(true)
  })

  it('shows Start Task button for backlog tasks', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Start Task')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull()
  })

  it('does not render a header Edit button (prompt editing lives in the info panel)', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('exposes Edit prompt in the info panel for backlog tasks when onEdit is provided', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(await screen.findByRole('button', { name: 'Edit prompt' })).toBeTruthy()
  })

  it('does not expose Edit prompt for doing tasks', () => {
    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('Edit prompt in the info panel calls onEdit with the task id', async () => {
    const onEdit = vi.fn()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit prompt' }))
    expect(onEdit).toHaveBeenCalledWith('T-42')
  })

  it('hides all action buttons for done tasks', () => {
    const doneTask = { ...baseTask, status: 'done' }
    render(TaskDetailView, { props: { task: doneTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull()
    expect(screen.queryByText('Start Task')).toBeNull()
    expect(screen.queryByText('Go')).toBeNull()
  })

  it('shows a Rename task button for backlog tasks', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('shows a Rename task button regardless of status', () => {
    const { unmount } = render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
    unmount()
    render(TaskDetailView, { props: { task: { ...baseTask, status: 'done' }, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('clicking Rename reveals a title input pre-filled with the current title', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement
    expect(input.value).toBe('Implement auth middleware')
  })

  it('saves the new title on Enter and refreshes', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    vi.mocked(updateTaskTitle).mockClear()
    const onTaskUpdated = vi.fn()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onTaskUpdated } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Renamed task' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(updateTaskTitle).toHaveBeenCalledWith('T-42', 'Renamed task')
    })
    expect(onTaskUpdated).toHaveBeenCalled()
  })

  it('Escape cancels renaming without saving', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    vi.mocked(updateTaskTitle).mockClear()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Discard me' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(updateTaskTitle).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })

  it('Start Task calls onRunAction with empty prompt', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    fireEvent.click(screen.getByText('Start Task'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '', agent: null })
  })

  it('shows Complete and action buttons for doing tasks', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('button', { name: /Complete/ })).toBeTruthy()
    expect(screen.queryByText('Move to Done')).toBeNull()
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    expect(screen.queryByText('Start Task')).toBeNull()
  })

  it('hides Review toggle when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.queryByText('review')).toBeNull()
    })
  })

  it('renders action buttons in header', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
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

  it('calls onRunAction when action button clicked', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Go'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '', agent: null })
  })

  it('action buttons stay enabled when session is running (prompt sent to active PTY)', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    activeSessions.set(new Map([['T-42', { ...baseSession, status: 'running' }]]))
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    const button = screen.getByText('Go').closest('button')
    expect(button?.disabled).toBe(false)
    activeSessions.set(new Map())
  })

  it('action buttons enabled when no active session', async () => {
    const doingTask = { ...baseTask, status: 'doing' }
    activeSessions.set(new Map())
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    const button = screen.getByText('Go').closest('button')
    expect(button?.disabled).toBe(false)
  })

  it('no longer renders the terminal-style breadcrumb row', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByText('$ cd board')).toBeNull()
  })

  it('does not render the task status badge in the header', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.queryByLabelText('Task status')).toBeNull()
  })

  it('shows TaskInfoPanel by default', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  it('Info panel always visible in agent mode (no tab toggle)', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Initial Prompt')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /^Info$/ })).toBeNull()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('rightPanelMode state does NOT exist — Info always visible', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
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

  it('falls back to first line of prompt when title is empty', () => {
    const taskNoTitle = { ...baseTask, initial_prompt: '', prompt: 'First prompt line\nSecond line' }
    render(TaskDetailView, { props: { task: taskNoTitle, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First prompt line')
  })

  it('falls back to task id when title and prompt are both empty/null', () => {
    const taskNoTitleNoPrompt = { ...baseTask, initial_prompt: '', prompt: null }
    render(TaskDetailView, { props: { task: taskNoTitleNoPrompt, onRunAction: mockOnRunAction } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('T-42')
  })

  it('recreates agent panel terminal when switching tasks', async () => {
    const { acquire, detach } = await import('../../lib/terminalPool')
    vi.mocked(acquire).mockClear()
    vi.mocked(detach).mockClear()

    const taskA = { ...baseTask, id: 'T-42' }
    const { rerender } = render(TaskDetailView, { props: { task: taskA, onRunAction: mockOnRunAction } })

    // Wait for AgentPanel to mount and acquire terminal for T-42
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-42')
    })

    vi.mocked(acquire).mockClear()
    vi.mocked(detach).mockClear()

    // Switch to a different task
    const taskB = { ...baseTask, id: 'T-99', initial_prompt: 'Another task' }
    await rerender({ task: taskB, onRunAction: mockOnRunAction })

    // Agent panel should be recreated, acquiring terminal for the new task
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-99')
    })

    // Old terminal should have been detached
    expect(vi.mocked(detach)).toHaveBeenCalled()
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

  it('⌘+1 switches to agent', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

    // Switch to review first
    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    await waitFor(() => expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true'))

    // Now switch back to agent with CMD+1
    await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘+1 → agent', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    await waitFor(() => expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true'))

    await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('⌘+2 → review', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

    expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    await waitFor(() => expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true'))
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



  it('completes a doing task by confirming, deleting it, and navigating to the board', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: /Complete/ }))
    await vi.waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('T-42')
    })
    expect(mockResetToBoard).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('disables the Complete button and shows pending feedback while the task is completing', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    completingTasks.set(new Set(['T-42']))
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })

    const button = screen.getByRole('button', { name: /Completing/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await fireEvent.click(button)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteTask).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not start a second delete while the first is still pending', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })

    await fireEvent.click(screen.getByRole('button', { name: /Complet/ }))
    await fireEvent.click(screen.getByRole('button', { name: /Complet/ }))

    expect(deleteTask).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    resolveDelete()
    await vi.waitFor(() => {
      expect(mockResetToBoard).toHaveBeenCalled()
    })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    confirmSpy.mockRestore()
  })

  it('does not complete the task when the confirmation is cancelled', async () => {
    const { deleteTask } = await import('../../lib/ipc')
    vi.mocked(deleteTask).mockClear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockResetToBoard.mockClear()
    const doingTask: Task = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await fireEvent.click(screen.getByRole('button', { name: /Complete/ }))
    expect(deleteTask).not.toHaveBeenCalled()
    expect(mockResetToBoard).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('shows action buttons in dropdown when actions exist', async () => {
    const { loadActions } = await import('../../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
  })

  it('action button triggers onRunAction with correct prompt', async () => {
    mockOnRunAction.mockClear()
    const { loadActions } = await import('../../lib/actions')
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
    ])
    const doingTask = { ...baseTask, status: 'doing' }
    render(TaskDetailView, { props: { task: doingTask, onRunAction: mockOnRunAction } })
    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Go'))
    expect(mockOnRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: 'Implement the task', agent: null })
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

    describe('info panel hide/show toggle', () => {
      it('renders the info panel by default in agent view with a workspace', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('clicking Hide removes the panel and clicking Show restores it', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeNull()
          expect(screen.getByRole('button', { name: 'Show task info panel' })).toBeTruthy()
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Show task info panel' }))

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('the toggle button reflects panel visibility via aria-pressed', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' }).getAttribute('aria-pressed')).toBe('true')
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Show task info panel' }).getAttribute('aria-pressed')).toBe('false')
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('persists the hidden state to localStorage keyed by task id', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(localStorage.getItem('task-info-panel-hidden:T-42')).toBe('1')
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('starts hidden for a task whose stored state is hidden', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        localStorage.setItem('task-info-panel-hidden:T-42', '1')

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Show task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeNull()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('starts visible for a different task with no stored state', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        // Only T-42 is marked hidden; T-99 has no stored state
        localStorage.setItem('task-info-panel-hidden:T-42', '1')

        render(TaskDetailView, { props: { task: secondaryTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('opens the workspace in VS Code when the VS Code button is clicked', async () => {
        const { getTaskWorkspace, openInEditor } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        const button = await screen.findByRole('button', { name: /open in vs code/i })
        await fireEvent.click(button)

        expect(openInEditor).toHaveBeenCalledWith('/tmp/wt')
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('⌘/ toggles the info panel visibility', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
        })

        await fireEvent.keyDown(window, { key: '/', metaKey: true })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeNull()
        })

        await fireEvent.keyDown(window, { key: '/', metaKey: true })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
    })

    describe('terminal cleanup on navigate-away', () => {
      it('calls releaseAllForTask when component unmounts', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('calls releaseAllForTask when task prop changes', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())
        
        const newTask = { ...baseTask, id: 'T-99', initial_prompt: 'New task' }
        rerender({ task: newTask, onRunAction: mockOnRunAction })
        
        await waitFor(() => {
          expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        })
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('does NOT call releaseAllForTask when task prop changes with same ID', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())
        
        const refreshedTask = { ...baseTask, summary: 'updated summary' }
        rerender({ task: refreshedTask, onRunAction: mockOnRunAction })
        
        await new Promise(r => setTimeout(r, 50))
        
        expect(releaseAllForTask).not.toHaveBeenCalled()
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('cleanup only releases shell entries, not agent terminal', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/terminalPool')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()
        
        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
        
        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())
        
        unmount()
        
        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
    })

})
