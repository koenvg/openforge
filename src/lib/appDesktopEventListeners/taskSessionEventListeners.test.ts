import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeAgentSession, getLatestSession } from '../ipc'
import { activeProjectId, activeSessions, checkpointNotification, selectedTaskId, taskRuntimeInfo } from '../stores'
import { evictTask, getVisibleRelationshipOwner, loadTaskDetail } from '../tasksState'
import { release, restorePtyInstance } from '../terminalPool'
import { createTaskSessionEventListeners } from './taskSessionEventListeners'
import { createAppDesktopEventHarness, createSession, registerEventListenerGroup } from './testUtils'

vi.mock('../terminalPool', () => ({
  release: vi.fn(),
  restorePtyInstance: vi.fn(),
}))
vi.mock('../tasksState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tasksState')>()
  return {
    ...actual,
    evictTask: vi.fn(),
    getVisibleRelationshipOwner: vi.fn(() => null),
    loadTaskDetail: vi.fn(),
  }
})


vi.mock('../ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc')>()
  return {
    ...actual,
    getLatestSession: vi.fn(),
    finalizeAgentSession: vi.fn(),
  }
})


describe('createTaskSessionEventListeners', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    checkpointNotification.set(null)
    taskRuntimeInfo.set(new Map())
    activeProjectId.set(null)
    selectedTaskId.set(null)
    vi.clearAllMocks()
  })

  it('marks action-complete sessions completed and clears checkpoint notification', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession()]]))
    checkpointNotification.set({
      ticketId: 'task-1',
      ticketKey: 'task-1',
      sessionId: 'session-1',
      stage: 'running',
      message: 'Agent needs input',
      timestamp: 123,
    })
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('action-complete')?.({ payload: { task_id: 'task-1' } })

    expect(get(activeSessions).get('task-1')?.status).toBe('completed')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBeNull()
    expect(get(checkpointNotification)).toBeNull()
    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('applies sidecar-forwarded OpenCode checkpoint events to active sessions', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running', checkpoint_data: null })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-event')?.({
      payload: {
        task_id: 'task-1',
        event_type: 'permission.asked',
        data: '{"properties":{"description":"Allow file write?"}}',
        timestamp: 123,
      },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('paused')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBe('{"properties":{"description":"Allow file write?"}}')
    expect(get(checkpointNotification)?.ticketId).toBe('task-1')
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('restores a reattached completed PTY before loading the latest session', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    vi.mocked(getLatestSession).mockResolvedValue(createSession({
      id: 'session-resumed',
      status: 'completed',
      pty_instance_id: 42,
    }))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('session-resumed')?.({
      payload: { task_id: 'task-1', workspace_path: '/tmp/work', pty_instance_id: 42 },
    })

    expect(restorePtyInstance).toHaveBeenCalledWith('task-1', 42)
    expect(get(taskRuntimeInfo).get('task-1')).toEqual({ workspacePath: '/tmp/work' })
    expect(get(activeSessions).get('task-1')).toMatchObject({
      id: 'session-resumed',
      status: 'completed',
    })
  })

  it('hydrates terminalPool with current PTY instance metadata from provider-neutral status events', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running' })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'running', pty_instance_id: 42 },
    })

    expect(restorePtyInstance).toHaveBeenCalledWith('task-1', 42)
    expect(get(activeSessions).get('task-1')?.status).toBe('running')
  })

  it('refreshes project attention even when a provider-neutral status event leaves local session state unchanged', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running' })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'running', kind: 'became_busy' },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('running')
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('raises a permission notification for provider-neutral paused permission events', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ provider: 'claude-code', status: 'running' })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'paused', kind: 'requested_permission' },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('paused')
    expect(get(checkpointNotification)).toMatchObject({
      ticketId: 'task-1',
      sessionId: 'session-1',
      stage: 'running',
      message: 'Agent needs permission',
    })
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('raises a permission notification when fetching an already-paused latest session', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    vi.mocked(getLatestSession).mockResolvedValue(createSession({ provider: 'claude-code', status: 'paused' }))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'paused', kind: 'requested_permission' },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('paused')
    expect(get(checkpointNotification)).toMatchObject({
      ticketId: 'task-1',
      sessionId: 'session-1',
      message: 'Agent needs permission',
    })
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('does not spam duplicate permission notifications for unchanged paused sessions', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ provider: 'claude-code', status: 'paused' })]]))
    checkpointNotification.set({
      ticketId: 'task-1',
      ticketKey: 'task-1',
      sessionId: 'session-1',
      stage: 'running',
      message: 'Agent needs permission',
      timestamp: 123,
    })
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'paused', kind: 'requested_permission' },
    })

    expect(get(checkpointNotification)?.timestamp).toBe(123)
  })

  it('marks active sessions failed from provider-neutral failed status events', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running', checkpoint_data: '{"pending":true}' })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'failed', kind: 'failed', pty_instance_id: 42 },
    })

    expect(get(activeSessions).get('task-1')?.status).toBe('failed')
    expect(get(activeSessions).get('task-1')?.checkpoint_data).toBeNull()
    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('does not reactivate an exited PTY from completed status metadata', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession({ status: 'running' })]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-status-changed')?.({
      payload: { task_id: 'task-1', status: 'completed', kind: 'ended', pty_instance_id: 42 },
    })

    expect(restorePtyInstance).not.toHaveBeenCalled()
    expect(get(activeSessions).get('task-1')?.status).toBe('completed')
  })

  it('finalizes agent PTY exits through the provider-neutral IPC wrapper', async () => {
    vi.useFakeTimers()
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('agent-pty-exited')?.({
      payload: { task_id: 'task-1', success: true, instance_id: 42 },
    })
    await vi.advanceTimersByTimeAsync(1500)

    expect(finalizeAgentSession).toHaveBeenCalledWith('task-1', true, 42)
    vi.useRealTimers()
  })

  it('reloads canonical active Tasks, pull requests, and attention after an update', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('task-changed')?.({
      payload: { action: 'updated', task_id: 'task-1', project_id: 'project-1' },
    })

    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('refreshes the visible detail through the project-scoped state owner', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeProjectId.set('project-1')
    selectedTaskId.set('task-owner')
    vi.mocked(getVisibleRelationshipOwner).mockReturnValue('task-owner')
    vi.mocked(loadTaskDetail).mockResolvedValue(null)
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('task-changed')?.({
      payload: { action: 'updated', task_id: 'task-related', project_id: 'project-1' },
    })

    expect(loadTaskDetail).toHaveBeenCalledWith(
      'project-1',
      'task-owner',
      undefined,
      expect.any(Function),
    )
  })

  it('evicts Task state, clears its session, and releases its terminal when deleted', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    activeSessions.set(new Map([['task-1', createSession()]]))
    await registerEventListenerGroup(createTaskSessionEventListeners(deps), deps.listen!)

    await handlers.get('task-changed')?.({ payload: { action: 'deleted', task_id: 'task-1' } })

    expect(get(activeSessions).has('task-1')).toBe(false)
    expect(evictTask).toHaveBeenCalledWith('task-1')
    expect(release).toHaveBeenCalledWith('task-1')
    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
  })
})
