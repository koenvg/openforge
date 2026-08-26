import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from '../../lib/githubSyncPlugin'
import type { AgentSession, Project, Task } from '../../lib/types'
import type { PluginEntry } from '../../lib/plugin/types'

const mockActiveSessions = writable<Map<string, AgentSession>>(new Map())
const mockProjects = writable<Project[]>([])
const mockActiveProjectId = writable<string | null>(null)
const mockCurrentView = writable<'board' | 'settings' | typeof GITHUB_SYNC_VIEW_KEY | 'plugin:com.openforge.task-schedules:schedules'>('board')
const mockSelectedTaskId = writable<string | null>(null)
const mockTasks = writable<Task[]>([])
const mockInstalledPlugins = writable<Map<string, PluginEntry>>(new Map())
const mockEnabledPluginIds = writable<Set<string>>(new Set())
const mockRuntimeContributionSources = writable(new Map<string, { pluginId: string; commands?: unknown[] }>())

const mockGetAllTasks = vi.fn<() => Promise<Task[]>>()
const mockGetLatestSessions = vi.fn<(taskIds: string[]) => Promise<AgentSession[]>>()
const mockExecutePluginCommand = vi.fn<(pluginId: string, commandId: string) => Promise<boolean>>()

vi.mock('../../lib/stores', () => ({
  activeSessions: mockActiveSessions,
  projects: mockProjects,
  activeProjectId: mockActiveProjectId,
  currentView: mockCurrentView,
  selectedTaskId: mockSelectedTaskId,
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
  getAllTasks: mockGetAllTasks,
  getLatestSessions: mockGetLatestSessions,
}))

vi.mock('../../lib/router.svelte', () => ({
  pushNavState: vi.fn(),
}))

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
    status: 'doing',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
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
  }
}

describe('CommandPalette component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSessions.set(new Map())
    mockProjects.set([])
    mockActiveProjectId.set(null)
    mockCurrentView.set('board')
    mockSelectedTaskId.set(null)
    mockTasks.set([])
    mockInstalledPlugins.set(new Map())
    mockEnabledPluginIds.set(new Set())
    mockRuntimeContributionSources.set(new Map())
    mockExecutePluginCommand.mockResolvedValue(true)
  })

  it('keeps listbox option ids linked to the search input and has no active descendant while loading or empty', async () => {
    let resolveTasks: (tasks: Task[]) => void = () => {}
    mockGetAllTasks.mockReturnValue(new Promise<Task[]>((resolve) => {
      resolveTasks = resolve
    }))
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    render(CommandPalette, { props: { onClose: vi.fn() } })

    const input = screen.getByPlaceholderText('Search tasks or commands...')
    expect(screen.getByRole('status').textContent).toContain('Loading tasks...')
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()

    resolveTasks([
      makeTask({ id: 'T-100', updated_at: 200 }),
      makeTask({ id: 'T-200', updated_at: 100 }),
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

  it('preserves keyboard selection when async session updates re-render the list', async () => {
    const paletteTasks = [
      makeTask({ id: 'T-100', updated_at: 300 }),
      makeTask({ id: 'T-200', updated_at: 200 }),
      makeTask({ id: 'T-300', updated_at: 100 }),
    ]

    mockGetAllTasks.mockResolvedValue(paletteTasks)
    mockGetLatestSessions.mockResolvedValue([])

    const { default: CommandPalette } = await import('./CommandPalette.svelte')
    const onClose = vi.fn()
    render(CommandPalette, { props: { onClose } })

    await waitFor(() => {
      expect(screen.getByText('T-100')).toBeTruthy()
      expect(mockGetAllTasks).toHaveBeenCalledOnce()
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
    mockGetAllTasks.mockResolvedValue([])
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
