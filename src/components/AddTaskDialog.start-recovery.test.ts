import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppTaskCreationDialogs from './shell/AppTaskCreationDialogs.svelte'
import { createTaskActionRunner } from '../lib/taskActionRunner'
import { useAppTaskCreationController } from '../lib/appTaskCreationController.svelte'
import { createTask, startImplementation } from '../lib/ipc'
import { activeProjectId, activeSessions, startingTasks, taskRuntimeInfo, error } from '../lib/stores'
import { refreshActiveTasks } from '../lib/tasksState'
import { requestTaskCompose, settleTaskCompose } from '../lib/taskCompose'
import { LocalTaskCreationAdapter } from './create-task/testing/localTaskCreationAdapter'

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn(() => ({ update() {}, destroy() {} })),
}))

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  startImplementation: vi.fn(),
  getSessionStatus: vi.fn().mockResolvedValue({ ticket_id: 'T-1', status: 'running' }),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/terminalSessionService', () => ({
  agentTerminalSessions: {
    isPtyActive: () => false,
    hasTerminal: () => false,
    acquire: async () => ({}),
    beginPtySpawn: () => null,
    release: vi.fn(),
    focusTerminal: vi.fn(),
  },
}))

const project = { id: 'project', path: '/repo', name: 'Project', created_at: 0, updated_at: 0 }

beforeEach(async () => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  activeProjectId.set(project.id)
  activeSessions.set(new Map())
  startingTasks.set(new Set())
  taskRuntimeInfo.set(new Map())
  error.set(null)
  await refreshActiveTasks(project.id, async () => ({ tasks: [], related: [] }))
  const adapter = new LocalTaskCreationAdapter()
  vi.mocked(createTask).mockResolvedValue(await adapter.createTask('Build', 'backlog', project.id, 'default'))
  vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session', workspace_path: '/repo', task_id: 'T-1', port: 0 })
})

describe('production task creation start recovery', () => {
  it('does not offer to restart a task when only the post-start refresh fails', async () => {
    const loadTasks = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('refresh offline'))
    const actions = createTaskActionRunner({ getActiveProject: () => project, loadTasks, logError: vi.fn() })
    const controller = useAppTaskCreationController({
      getTasks: () => [], loadTasks,
      resetToBoard: () => {}, navigateToTask: () => {},
      runAction: actions.runActionOrThrow,
    })
    const pending = requestTaskCompose({ projectId: project.id, initialPrompt: 'Build' })
    const { unmount } = render(AppTaskCreationDialogs, { props: { controller, projectPath: project.path, projectName: project.name } })
    try {
      const start = await screen.findByRole('button', { name: /start task/i })
      await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
      await fireEvent.click(start)
      await expect(pending).resolves.toMatchObject({ task: { id: 'T-1' }, started: true })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(startImplementation).toHaveBeenCalledOnce()
      expect(createTask).toHaveBeenCalledOnce()
    } finally {
      unmount()
      settleTaskCompose(null)
    }
  })

  it.each(['normal', 'compose'] as const)('retries a provider failure through the %s controller without creating again', async (mode) => {
    vi.mocked(startImplementation).mockRejectedValueOnce(new Error('provider unavailable'))
    const loadTasks = async () => {}
    const actions = createTaskActionRunner({ getActiveProject: () => project, loadTasks, logError: vi.fn() })
    const controller = useAppTaskCreationController({
      getTasks: () => [], loadTasks,
      resetToBoard: () => {}, navigateToTask: () => {},
      runAction: actions.runActionOrThrow,
    })
    const pending = mode === 'compose' ? requestTaskCompose({ projectId: project.id, initialPrompt: 'Build' }) : null
    if (mode === 'normal') controller.openNewTask()
    const { unmount } = render(AppTaskCreationDialogs, { props: { controller, projectPath: project.path, projectName: project.name } })
    try {
      if (mode === 'normal') {
        await fireEvent.input(await screen.findByRole('textbox', { name: 'What should the agent do?' }), { target: { value: 'Build' } })
      }
      const start = await screen.findByRole('button', { name: /start task/i })
      await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
      await fireEvent.click(start)
      expect((await screen.findByRole('alert')).textContent).toContain('provider unavailable')
      expect(screen.getByRole('dialog')).toBeTruthy()
      await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(createTask).toHaveBeenCalledOnce()
      expect(startImplementation).toHaveBeenCalledTimes(2)
      expect(vi.mocked(startImplementation).mock.calls.map(([id]) => id)).toEqual(['T-1', 'T-1'])
      if (pending) await expect(pending).resolves.toMatchObject({ task: { id: 'T-1' }, started: true })
    } finally {
      unmount()
      settleTaskCompose(null)
    }
  })
})
