import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ExistingBranchPlan, Project, TaskDetail } from './types'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
  getSessionStatus: vi.fn(),
  inspectExistingBranch: vi.fn(),
  startImplementation: vi.fn(),
}))

vi.mock('./ptySubmit', () => ({
  writePtyWithSubmit: vi.fn(),
}))

vi.mock('./terminalSessionService', () => ({
  agentTerminalSessions: {
    acquire: vi.fn().mockResolvedValue({ shellSessionKey: 'T-42' }),
    beginPtySpawn: vi.fn(),
    focusTerminal: vi.fn(),
    hasTerminal: vi.fn(() => false),
    isPtyActive: vi.fn(() => false),
    release: vi.fn(),
  },
}))

import { createTaskSessionActions } from './taskSessionActions'
import { deleteTask, getSessionStatus, inspectExistingBranch, startImplementation } from './ipc'
import { branchDivergenceRequest } from './branchDivergenceModalStore'
import { agentTerminalSessions } from './terminalSessionService'
import { writePtyWithSubmit } from './ptySubmit'
import {
  activeSessions,
  completingTasks,
  error,
  startingTasks,
  taskStartErrors,
  taskDetailsById,
  taskRuntimeInfo,
} from './stores'
import { refreshActiveTasks } from './tasksState'

const {
  acquire,
  beginPtySpawn,
  focusTerminal,
  hasTerminal,
  isPtyActive,
  release,
} = agentTerminalSessions

function createSpawnLease(imageProtocol: 'iterm2' | null = null) {
  return {
    generation: 1,
    geometry: { cols: 80, rows: 24 },
    imageProtocol,
    started: vi.fn(async () => undefined),
    cancel: vi.fn(),
  }
}

const activeProject: Project = {
  id: 'proj-1',
  name: 'Project',
  path: '/project',
  created_at: 1000,
  updated_at: 1000,
}

const task: TaskDetail = {
  id: 'T-42',
  prompt: 'Prompt',
  promptPreview: 'Prompt',
  title: 'Prompt',
  titleSource: null,
  titleGeneratedAt: null,
  status: 'doing',
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  projectId: 'proj-1',
  createdAt: 1000,
  updatedAt: 1000,
  completedAt: null,
  labels: [],
}

async function setTasks(items: TaskDetail[]): Promise<void> {
  await refreshActiveTasks(activeProject.id, async () => ({ tasks: items, related: [] }))
}

function createActions(loadTasks: () => Promise<void> = vi.fn(async () => undefined)) {
  return createTaskSessionActions({
    getActiveProject: () => activeProject,
    loadTasks,
    logError: vi.fn(),
  })
}

function existingBranchTask(): TaskDetail {
  return { ...task, worktreeSource: 'existingBranch', worktreeBranch: 'origin/foo' }
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
  beforeEach(async () => {
    vi.clearAllMocks()
    activeSessions.set(new Map())
    completingTasks.set(new Set())
    error.set(null)
    startingTasks.set(new Set())
    taskStartErrors.set(new Map())
    taskDetailsById.set(new Map())
    taskRuntimeInfo.set(new Map())
    await setTasks([])
    branchDivergenceRequest.set(null)
    vi.mocked(isPtyActive).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({ shellSessionKey: 'T-42' } as never)
    vi.mocked(beginPtySpawn).mockReturnValue(createSpawnLease())
    vi.mocked(hasTerminal).mockReturnValue(false)
  })

  it('delivers input to a live agent while its post-start refresh is still pending', async () => {
    let finishRefresh!: () => void
    const loadTasks = () => new Promise<void>(resolve => { finishRefresh = resolve })
    vi.mocked(startImplementation).mockResolvedValueOnce({ session_id: 's', workspace_path: '/w', task_id: task.id, port: 0 })
    vi.mocked(getSessionStatus).mockResolvedValueOnce({ ticket_id: task.id, status: 'running' } as never)
    const actions = createActions(loadTasks)
    const startup = actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    vi.mocked(isPtyActive).mockReturnValue(true)
    await actions.handleRunAction({ taskId: task.id, actionPrompt: 'Continue with tests' })
    expect(writePtyWithSubmit).toHaveBeenCalledExactlyOnceWith(task.id, 'Continue with tests')
    expect(startImplementation).toHaveBeenCalledOnce()
    finishRefresh()
    await startup
  })

  it('guards pending preflight and uses saved detail before the list refresh', async () => {
    const saved = existingBranchTask()
    taskDetailsById.set(new Map([[saved.id, saved]]))
    let finish!: (value: ExistingBranchPlan) => void
    vi.mocked(inspectExistingBranch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(startImplementation).mockRejectedValueOnce(new Error('start failed'))
    const actions = createActions()
    const starting = actions.handleRunAction({ taskId: saved.id, actionPrompt: '' })
    expect(get(startingTasks).has(saved.id)).toBe(true)
    await actions.handleRunAction({ taskId: saved.id, actionPrompt: '' })
    expect(inspectExistingBranch).toHaveBeenCalledExactlyOnceWith('/project', 'origin/foo')
    finish(plan('autoFastForward'))
    await starting
    expect(startImplementation).toHaveBeenCalledTimes(1)
    expect(get(startingTasks).has(saved.id)).toBe(false)
  })

  it('clears a previous failure when retrying and refuses another pending or active start', async () => {
    taskStartErrors.set(new Map([[task.id, 'provider offline']]))
    let finish!: (value: Awaited<ReturnType<typeof startImplementation>>) => void
    vi.mocked(startImplementation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(getSessionStatus).mockResolvedValueOnce({ ticket_id: task.id, status: 'running' } as never)
    const actions = createActions()
    const pending = actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    expect(get(taskStartErrors).has(task.id)).toBe(false)
    await vi.waitFor(() => expect(startImplementation).toHaveBeenCalledOnce())
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    expect(startImplementation).toHaveBeenCalledOnce()
    finish({ session_id: 's', workspace_path: '/w', task_id: task.id, port: 0 })
    await pending
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    expect(startImplementation).toHaveBeenCalledOnce()
    expect(get(taskStartErrors).has(task.id)).toBe(false)
  })

  it.each(['refresh', 'focus'] as const)('does not classify a post-start %s failure as a retryable start failure', async (failure) => {
    vi.mocked(startImplementation).mockResolvedValueOnce({ session_id: 's', workspace_path: '/w', task_id: task.id, port: 0 })
    vi.mocked(getSessionStatus).mockResolvedValueOnce({ ticket_id: task.id, status: 'running' } as never)
    const loadTasks = vi.fn(async () => {})
    if (failure === 'refresh') loadTasks.mockRejectedValueOnce(new Error('refresh offline'))
    else vi.mocked(focusTerminal).mockImplementationOnce(() => { throw new Error('focus unavailable') })
    const actions = createActions(loadTasks)
    await expect(actions.runActionOrThrow({ taskId: task.id, actionPrompt: '' })).resolves.toBeUndefined()
    expect(get(taskStartErrors).has(task.id)).toBe(false)
    expect(get(error)).toContain(failure)
    expect(release).not.toHaveBeenCalled()
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    expect(startImplementation).toHaveBeenCalledOnce()
  })

  it('keeps startup failure on the saved task after its dialog is gone', async () => {
    vi.mocked(startImplementation).mockRejectedValueOnce(new Error('provider unavailable'))
    const actions = createActions()
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })
    expect(get(taskStartErrors).get(task.id)).toContain('provider unavailable')
    expect(get(startingTasks).has(task.id)).toBe(false)
  })

  it('starts a task, stores runtime/session state, reloads tasks, and clears starting state', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: task.id, status: 'running' } as never)
    vi.mocked(beginPtySpawn).mockReturnValue(createSpawnLease('iterm2'))
    const actions = createActions(loadTasks)

    await setTasks([task])
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })

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

    await setTasks([task])
    await actions.handleRunAction({
      taskId: task.id,
      actionPrompt: '',
      promptPrefix: 'Verify this is still relevant.',
    })

    expect(startImplementation).toHaveBeenCalledWith(task.id, activeProject.path, 'auto', null, 'Verify this is still relevant.')
  })

  it('sends a null prefix when the start carries none', async () => {
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as never)
    const actions = createActions()

    await setTasks([task])
    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })

    expect(vi.mocked(startImplementation).mock.calls[0][4]).toBeNull()
  })

  it('ignores the prefix when a PTY is already live', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const actions = createActions()

    await setTasks([task])
    await actions.handleRunAction({
      taskId: task.id,
      actionPrompt: 'continue',
      promptPrefix: 'Verify this is still relevant.',
    })

    expect(startImplementation).not.toHaveBeenCalled()
    expect(writePtyWithSubmit).toHaveBeenCalledWith(task.id, 'continue')
  })

  it('releases a terminal created for an implementation start that fails', async () => {
    vi.mocked(startImplementation).mockRejectedValue(new Error('start failed'))
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })

    expect(release).toHaveBeenCalledWith(task.id)
  })

  it('preserves a pre-existing terminal when an implementation start fails', async () => {
    vi.mocked(hasTerminal).mockReturnValue(true)
    vi.mocked(startImplementation).mockRejectedValue(new Error('start failed'))
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: '' })

    expect(release).not.toHaveBeenCalled()
  })

  it('auto-starts an existing-branch task that fast-forwards without opening the modal', async () => {
    const branchTask = existingBranchTask()
    await setTasks([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(plan('autoFastForward'))
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as never)
    const actions = createActions()

    await actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '' })

    expect(inspectExistingBranch).toHaveBeenCalledWith(activeProject.path, 'origin/foo')
    expect(get(branchDivergenceRequest)).toBeNull()
    expect(startImplementation).toHaveBeenCalledWith(branchTask.id, activeProject.path, 'auto', null, null)
  })

  it('opens the divergence modal for a diverged branch and threads the chosen resolution', async () => {
    const branchTask = existingBranchTask()
    await setTasks([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(
      plan('diverged', { ahead: [{ shortSha: 'a1b2c3d', subject: 'WIP', author: 'me', relativeDate: '1h ago' }] }),
    )
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as never)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as never)
    const actions = createActions()

    const started = actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '' })
    await vi.waitFor(() => expect(get(branchDivergenceRequest)).not.toBeNull())
    get(branchDivergenceRequest)!.resolve('keepLocal')
    branchDivergenceRequest.set(null)
    await started

    expect(startImplementation).toHaveBeenCalledWith(branchTask.id, activeProject.path, 'keepLocal', null, null)
  })

  it('aborts the start when the divergence modal is cancelled', async () => {
    const branchTask = existingBranchTask()
    await setTasks([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(plan('diverged'))
    const actions = createActions()

    const started = actions.handleRunAction({ taskId: branchTask.id, actionPrompt: '' })
    await vi.waitFor(() => expect(get(branchDivergenceRequest)).not.toBeNull())
    get(branchDivergenceRequest)!.resolve('cancel')
    branchDivergenceRequest.set(null)
    await started

    expect(startImplementation).not.toHaveBeenCalled()
    expect(get(startingTasks).has(task.id)).toBe(false)
    expect(get(taskStartErrors).get(task.id)).toContain('Task start was canceled.')
  })

  it('writes to an active PTY instead of starting a new implementation', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const actions = createActions()

    await actions.handleRunAction({ taskId: task.id, actionPrompt: 'continue' })

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
