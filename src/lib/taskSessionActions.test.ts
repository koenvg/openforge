import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ExistingBranchPlan, Project, Task } from './types'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
  getSessionStatus: vi.fn(),
  inspectExistingBranch: vi.fn(),
  startImplementation: vi.fn(),
}))

vi.mock('./ptySubmit', () => ({
  writePtyWithSubmit: vi.fn(),
}))

vi.mock('./terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue({}),
  focusTerminal: vi.fn(),
  getTerminalImageProtocol: vi.fn(() => null),
  hasTerminal: vi.fn(() => false),
  isPtyActive: vi.fn(() => false),
  release: vi.fn(),
}))

import { createTaskSessionActions } from './taskSessionActions'
import { deleteTask, getSessionStatus, inspectExistingBranch, startImplementation } from './ipc'
import { branchDivergenceRequest } from './branchDivergenceModalStore'
import {
  acquire,
  focusTerminal,
  getTerminalImageProtocol,
  hasTerminal,
  isPtyActive,
  release,
} from './terminalPool'
import { writePtyWithSubmit } from './ptySubmit'
import {
  activeSessions,
  completingTasks,
  error,
  startingTasks,
  taskRuntimeInfo,
  tasks,
} from './stores'

const activeProject: Project = {
  id: 'proj-1',
  name: 'Project',
  path: '/project',
  created_at: 1000,
  updated_at: 1000,
}

const task: Task = {
  id: 'T-42',
  initial_prompt: 'Prompt',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  status: 'doing',
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 1000,
}

function createActions(loadTasks = vi.fn(async () => undefined)) {
  return createTaskSessionActions({
    getActiveProject: () => activeProject,
    loadTasks,
    logError: vi.fn(),
  })
}

function existingBranchTask(): Task {
  return { ...task, worktree_source: 'existingBranch', worktree_branch: 'origin/foo' }
}

function plan(
  relation: ExistingBranchPlan['relation'],
  overrides: Partial<ExistingBranchPlan> = {},
): ExistingBranchPlan {
  return {
    relation,
    ahead: [],
    behind: [],
    aheadTruncated: false,
    behindTruncated: false,
    remoteReachable: true,
    ...overrides,
  }
}

describe('createTaskSessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSessions.set(new Map())
    completingTasks.set(new Set())
    error.set(null)
    startingTasks.set(new Set())
    taskRuntimeInfo.set(new Map())
    tasks.set([])
    branchDivergenceRequest.set(null)
    vi.mocked(isPtyActive).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({} as never)
    vi.mocked(getTerminalImageProtocol).mockReturnValue(null)
    vi.mocked(hasTerminal).mockReturnValue(false)
  })

  it('starts a task, stores runtime/session state, reloads tasks, and clears starting state', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: task.id, status: 'running' } as never)
    vi.mocked(getTerminalImageProtocol).mockReturnValue('iterm2')
    const actions = createActions(loadTasks)

    tasks.set([task])
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(inspectExistingBranch).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledWith(task.id)
    expect(startImplementation).toHaveBeenCalledWith(task.id, activeProject.path, 'auto', 'iterm2', null)
    expect(get(taskRuntimeInfo).get(task.id)).toEqual({ workspacePath: '/workspace/T-42' })
    expect(get(activeSessions).get(task.id)).toEqual({ ticket_id: task.id, status: 'running' })
    expect(loadTasks).toHaveBeenCalledOnce()
    expect(focusTerminal).toHaveBeenCalledWith(task.id)
    expect(get(startingTasks).has(task.id)).toBe(false)
  })

  it('passes a one-off prompt prefix to the sidecar on a cold start', async () => {
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as never)
    const actions = createActions()

    tasks.set([task])
    await actions.handleRunAction({
      taskId: task.id,
      actionPrompt: '',
      agent: null,
      promptPrefix: 'Verify this is still relevant.',
    })

    expect(startImplementation).toHaveBeenCalledWith(task.id, activeProject.path, 'auto', null, 'Verify this is still relevant.')
  })

  it('sends a null prefix when the start carries none', async () => {
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as never)
    const actions = createActions()

    tasks.set([task])
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(vi.mocked(startImplementation).mock.calls[0][4]).toBeNull()
  })

  it('ignores the prefix when a PTY is already live', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const actions = createActions()

    tasks.set([task])
    await actions.handleRunAction({
      taskId: task.id,
      actionPrompt: 'continue',
      agent: null,
      promptPrefix: 'Verify this is still relevant.',
    })

    expect(startImplementation).not.toHaveBeenCalled()
    expect(writePtyWithSubmit).toHaveBeenCalledWith(task.id, 'continue')
  })

  it('releases a terminal created for an implementation start that fails', async () => {
    vi.mocked(startImplementation).mockRejectedValue(new Error('start failed'))
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(release).toHaveBeenCalledWith(task.id)
  })

  it('preserves a pre-existing terminal when an implementation start fails', async () => {
    vi.mocked(hasTerminal).mockReturnValue(true)
    vi.mocked(startImplementation).mockRejectedValue(new Error('start failed'))
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(release).not.toHaveBeenCalled()
  })

  it('auto-starts an existing-branch task that fast-forwards without opening the modal', async () => {
    const branchTask = existingBranchTask()
    tasks.set([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(plan('autoFastForward'))
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as never)
    const actions = createActions()

    await actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })

    expect(inspectExistingBranch).toHaveBeenCalledWith(activeProject.path, 'origin/foo')
    expect(get(branchDivergenceRequest)).toBeNull()
    expect(startImplementation).toHaveBeenCalledWith(branchTask.id, activeProject.path, 'auto', null, null)
  })

  it('opens the divergence modal for a diverged branch and threads the chosen resolution', async () => {
    const branchTask = existingBranchTask()
    tasks.set([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(
      plan('diverged', { ahead: [{ shortSha: 'a1b2c3d', subject: 'WIP', author: 'me', relativeDate: '1h ago' }] }),
    )
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as never)
    const actions = createActions()

    const started = actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })
    await vi.waitFor(() => expect(get(branchDivergenceRequest)).not.toBeNull())
    get(branchDivergenceRequest)!.resolve('keepLocal')
    branchDivergenceRequest.set(null)
    await started

    expect(startImplementation).toHaveBeenCalledWith(branchTask.id, activeProject.path, 'keepLocal', null, null)
  })

  it('aborts the start when the divergence modal is cancelled', async () => {
    const branchTask = existingBranchTask()
    tasks.set([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(plan('diverged'))
    const actions = createActions()

    const started = actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })
    await vi.waitFor(() => expect(get(branchDivergenceRequest)).not.toBeNull())
    get(branchDivergenceRequest)!.resolve('cancel')
    branchDivergenceRequest.set(null)
    await started

    expect(startImplementation).not.toHaveBeenCalled()
  })

  it('writes to an active PTY instead of starting a new implementation', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: 'continue', agent: null })

    expect(writePtyWithSubmit).toHaveBeenCalledWith(task.id, 'continue')
    expect(startImplementation).not.toHaveBeenCalled()
    expect(focusTerminal).toHaveBeenCalledWith(task.id)
  })

  it('reloads tasks after successful completion', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    const actions = createActions(loadTasks)

    await actions.deleteTaskAndReload(task.id)

    expect(deleteTask).toHaveBeenCalledWith(task.id)
    expect(loadTasks).toHaveBeenCalledOnce()
    expect(get(completingTasks).has(task.id)).toBe(false)
  })

  it('surfaces completion failures without reloading', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(deleteTask).mockRejectedValue(new Error('delete blew up'))
    const actions = createActions(loadTasks)

    await actions.deleteTaskAndReload(task.id)

    expect(get(error)).toContain('delete blew up')
    expect(loadTasks).not.toHaveBeenCalled()
    expect(get(completingTasks).has(task.id)).toBe(false)
  })

  it('skips a task that is already completing', async () => {
    const loadTasks = vi.fn(async () => undefined)
    completingTasks.set(new Set([task.id]))
    const actions = createActions(loadTasks)

    await actions.deleteTaskAndReload(task.id)

    expect(deleteTask).not.toHaveBeenCalled()
    expect(loadTasks).not.toHaveBeenCalled()
  })
})
