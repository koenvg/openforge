import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
import { TASK_SCHEDULES_VIEW_KEY } from '../../lib/taskSchedulesPlugin'
import type { ActiveTasks, AgentSession, Project, TaskDetail } from '../../lib/types'
import { createTask } from '../../App.test-fixtures/tasks'
import type { PluginEntry } from '../../lib/plugin/types'

const mockActiveSessions = writable<Map<string, AgentSession>>(new Map())
const mockProjects = writable<Project[]>([])
const mockActiveProjectId = writable<string | null>(null)
const mockCurrentView = writable<'board' | 'settings' | typeof GITHUB_SYNC_VIEW_KEY | typeof TASK_SCHEDULES_VIEW_KEY>('board')
const mockSelectedTaskId = writable<string | null>(null)
const mockPendingTask = writable<TaskDetail | null>(null)
const mockTasks = writable<TaskDetail[]>([])
const mockInstalledPlugins = writable<Map<string, PluginEntry>>(new Map())
const mockEnabledPluginIds = writable<Set<string>>(new Set())
const mockRuntimeContributionSources = writable(new Map<string, { pluginId: string; commands?: unknown[] }>())

const mockReadActiveTasks = vi.fn<(projectId: string) => Promise<ActiveTasks>>()
const mockGetLatestSessions = vi.fn<(taskIds: string[]) => Promise<AgentSession[]>>()
const mockExecutePluginCommand = vi.fn<(pluginId: string, commandId: string) => Promise<boolean>>()

vi.mock('../../lib/stores', () => ({
  activeSessions: mockActiveSessions,
  projects: mockProjects,
  activeProjectId: mockActiveProjectId,
  currentView: mockCurrentView,
  selectedTaskId: mockSelectedTaskId,
  pendingTask: mockPendingTask,
  tasks: mockTasks,
}))

vi.mock('../../lib/plugin/pluginStore', () => ({
  installedPlugins: mockInstalledPlugins,
  enabledPluginIds: mockEnabledPluginIds,
  runtimeContributionSources: mockRuntimeContributionSources,
}))

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  executePluginCommand: mockExecutePluginCommand,
}))

vi.mock('../../lib/ipc', () => ({
  readActiveTasks: mockReadActiveTasks,
  getLatestSessions: mockGetLatestSessions,
}))

vi.mock('../../lib/router.svelte', () => ({
  pushNavState: vi.fn(),
}))

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<TaskDetail> & { id: string }): TaskDetail {
  return createTask(overrides)
}

function activePage(tasks: TaskDetail[]): ActiveTasks {
  return { tasks, related: [] }
}
function makeSession(taskId: string, status: string): AgentSession {
  return {
    id: `session-${taskId}`,
    ticket_id: taskId,
    opencode_session_id: null,
    stage: 'implementation',
    status,
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    output_revision: 0,
    viewed_output_revision: 0,
  }
}

describe('CommandPalette component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessions.set(new Map())
    mockProjects.set([{ id: 'P-1', name: 'Project', path: '/tmp/project', created_at: 1, updated_at: 1 }])
    mockActiveProjectId.set(null)
    mockCurrentView.set('board')
    mockSelectedTaskId.set(null)
    mockPendingTask.set(null)
    mockTasks.set([])
    mockInstalledPlugins.set(new Map())
    mockEnabledPluginIds.set(new Set())
    mockRuntimeContributionSources.set(new Map())
    mockExecutePluginCommand.mockResolvedValue(true)
  })

  it('keeps listbox option ids linked to the search input and has no active descendant while loading or empty', async () => {
    let resolveTasks: (tasks: TaskDetail[]) => void = () => {}
    mockReadActiveTasks.mockImplementationOnce((_projectId) =>
      new Promise<ActiveTasks>((resolve) => {
        resolveTasks = (tasks) => resolve(activePage(tasks))
      }),
    )
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    render(CommandPalette, { props: { onClose: vi.fn() } })

    const input = screen.getByPlaceholderText('Search tasks or commands...')
    expect(screen.getByRole('status').textContent).toContain('Loading tasks...')
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()

    resolveTasks([
      makeTask({ id: 'T-100', updatedAt: 200 }),
      makeTask({ id: 'T-200', updatedAt: 100 }),
    ])

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(listbox.id).not.toBe('')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(options.every(option => option.id !== '')).toBe(true)
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)

    await fireEvent.input(input, { target: { value: 'no matching task' } })

    expect(screen.getByText(/no tasks or commands match/i)).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('loads only active snapshot Tasks and batches sessions for active IDs', async () => {
    const active = makeTask({ id: 'T-active', status: 'doing' })
    const completed = makeTask({ id: 'T-completed', status: 'done' })
    mockReadActiveTasks.mockImplementationOnce(async (_projectId) =>
      activePage([active, completed]),
    )
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    render(CommandPalette, { props: { onClose: vi.fn() } })

    await waitFor(() => expect(screen.getByText('T-active')).toBeTruthy())
    expect(screen.queryByText('T-completed')).toBeNull()
    expect(mockReadActiveTasks).toHaveBeenCalledOnce()
    expect(mockGetLatestSessions).toHaveBeenCalledWith(['T-active'])
  })


  it('preserves keyboard selection when async session updates re-render the list', async () => {
    const paletteTasks = [
      makeTask({ id: 'T-100', updatedAt: 300 }),
      makeTask({ id: 'T-200', updatedAt: 200 }),
      makeTask({ id: 'T-300', updatedAt: 100 }),
    ]

    mockReadActiveTasks.mockImplementationOnce(async (_projectId) => activePage(paletteTasks))
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    const onClose = vi.fn()
    render(CommandPalette, { props: { onClose } })

    await waitFor(() => {
      expect(screen.getByText('T-100')).toBeTruthy()
      expect(mockReadActiveTasks).toHaveBeenCalledOnce()
      expect(mockGetLatestSessions).toHaveBeenCalledWith(['T-100', 'T-200', 'T-300'])
    })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'ArrowDown' })

    mockActiveSessions.set(new Map([['T-300', makeSession('T-300', 'paused')]]))

    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(get(mockSelectedTaskId)).toBe('T-200')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders plugin commands in the palette and executes them on selection', async () => {
    mockReadActiveTasks.mockImplementationOnce(async (_projectId) => activePage([]))
    mockGetLatestSessions.mockResolvedValue([])
    mockInstalledPlugins.set(new Map([[
      'plugin.commands',
      {
        manifest: {
          id: 'plugin.commands',
          name: 'Command Plugin',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Adds commands',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      },
    ]]))
    mockEnabledPluginIds.set(new Set(['plugin.commands']))
    mockRuntimeContributionSources.set(new Map([[
      'plugin.commands',
      {
        pluginId: 'plugin.commands',
        commands: [
          { id: 'sync-now', title: 'Sync Now', shortcut: 'Cmd+Shift+S' },
          { id: 'internal-sync', title: 'Internal Sync', discoverable: false },
        ],
      },
    ]]))

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    const onClose = vi.fn()
    render(CommandPalette, { props: { onClose } })

    await waitFor(() => {
      expect(screen.getByText('Sync Now')).toBeTruthy()
      expect(screen.getByText('Command Plugin')).toBeTruthy()
    })
    expect(screen.queryByText('Internal Sync')).toBeNull()

    await fireEvent.click(screen.getByRole('option', { name: /sync now/i }))

    expect(mockExecutePluginCommand).toHaveBeenCalledWith('plugin.commands', 'sync-now')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
