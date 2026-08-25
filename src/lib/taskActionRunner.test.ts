import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import type { PullRequestInfo, Project, Task } from './types'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
  getProjectConfig: vi.fn(),
  getSessionStatus: vi.fn(),
  mergePullRequest: vi.fn(),
  refreshTaskGithubStatus: vi.fn(),
  enqueuePullRequest: vi.fn(),
  startImplementation: vi.fn(),
  inspectExistingBranch: vi.fn(),
  setProjectConfig: vi.fn(),
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

import { createOutOfFocusController } from '../components/focus-board/outOfFocusController.svelte'
import { createOutOfFocusTaskMembershipState } from './outOfFocusTaskMembership'
import { createTaskActionRunner } from './taskActionRunner'
import {
  activeSessions,
  completingTasks,
  error,
  outOfFocusTaskIdsByProject,
  startingTasks,
  taskRuntimeInfo,
  tasks,
  ticketPrs,
} from './stores'
import { deleteTask, enqueuePullRequest, getProjectConfig, getSessionStatus, inspectExistingBranch, mergePullRequest, refreshTaskGithubStatus, setProjectConfig, startImplementation } from './ipc'
import { branchDivergenceRequest } from './branchDivergenceModalStore'
import { acquire, focusTerminal, getTerminalImageProtocol, hasTerminal, isPtyActive, release } from './terminalPool'
import { writePtyWithSubmit } from './ptySubmit'
import type { ExistingBranchPlan } from './types'

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

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: task.id,
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'PR',
    url: 'https://example.com/pr',
    state: 'open',
    merged_at: null,
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    ...overrides,
  }
}

describe('createTaskActionRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSessions.set(new Map())
    completingTasks.set(new Set())
    error.set(null)
    outOfFocusTaskIdsByProject.set(new Map())
    startingTasks.set(new Set())
    taskRuntimeInfo.set(new Map())
    ticketPrs.set(new Map())
    tasks.set([])
    branchDivergenceRequest.set(null)
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    vi.mocked(isPtyActive).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({} as never)
    vi.mocked(getTerminalImageProtocol).mockReturnValue(null)
    vi.mocked(hasTerminal).mockReturnValue(false)
  })

  it('starts a task, stores runtime/session state, reloads tasks, and clears starting state', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as any)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: task.id, status: 'running' } as any)
    vi.mocked(getTerminalImageProtocol).mockReturnValue('iterm2')

    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks,
    })

    tasks.set([task])
    await runner.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    // Non-existing-branch task: the gate never touches the remote and starts
    // immediately with the defensive `auto` resolution.
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
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as any)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    tasks.set([task])
    await runner.handleRunAction({
      taskId: task.id,
      actionPrompt: '',
      agent: null,
      promptPrefix: 'Verify this is still relevant.',
    })

    expect(startImplementation).toHaveBeenCalledWith(task.id, activeProject.path, 'auto', null, 'Verify this is still relevant.')
  })

  it('sends a null prefix when the start carries none', async () => {
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 'session-1', workspace_path: '/workspace/T-42', task_id: task.id, port: 0 } as any)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    tasks.set([task])
    await runner.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(vi.mocked(startImplementation).mock.calls[0][4]).toBeNull()
  })

  it('ignores the prefix when a PTY is already live', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    tasks.set([task])
    await runner.handleRunAction({
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
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    await runner.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(release).toHaveBeenCalledWith(task.id)
  })

  it('preserves a pre-existing terminal when an implementation start fails', async () => {
    vi.mocked(hasTerminal).mockReturnValue(true)
    vi.mocked(startImplementation).mockRejectedValue(new Error('start failed'))
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    await runner.handleRunAction({ taskId: task.id, actionPrompt: '', agent: null })

    expect(release).not.toHaveBeenCalled()
  })

  function existingBranchTask(): Task {
    return { ...task, worktree_source: 'existingBranch', worktree_branch: 'origin/foo' }
  }

  function plan(relation: ExistingBranchPlan['relation'], overrides: Partial<ExistingBranchPlan> = {}): ExistingBranchPlan {
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

  it('auto-starts an existing-branch task that fast-forwards without opening the modal', async () => {
    const branchTask = existingBranchTask()
    tasks.set([branchTask])
    vi.mocked(inspectExistingBranch).mockResolvedValue(plan('autoFastForward'))
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as any)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as any)

    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    await runner.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })

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
    vi.mocked(startImplementation).mockResolvedValue({ session_id: 's', workspace_path: '/w', task_id: branchTask.id, port: 0 } as any)
    vi.mocked(getSessionStatus).mockResolvedValue({ ticket_id: branchTask.id, status: 'running' } as any)

    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    const started = runner.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })
    // The modal request is now pending; resolve it with the user's choice.
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

    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    const started = runner.handleRunAction({ taskId: branchTask.id, actionPrompt: '', agent: null })
    await vi.waitFor(() => expect(get(branchDivergenceRequest)).not.toBeNull())
    get(branchDivergenceRequest)!.resolve('cancel')
    branchDivergenceRequest.set(null)
    await started

    expect(startImplementation).not.toHaveBeenCalled()
  })

  it('writes to an active PTY instead of starting a new implementation', async () => {
    vi.mocked(isPtyActive).mockReturnValue(true)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })

    await runner.handleRunAction({ taskId: task.id, actionPrompt: 'continue', agent: null })

    expect(writePtyWithSubmit).toHaveBeenCalledWith(task.id, 'continue')
    expect(startImplementation).not.toHaveBeenCalled()
    expect(focusTerminal).toHaveBeenCalledWith(task.id)
  })

  it('does not merge and sets the exact disambiguation error when multiple PRs are ready', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const firstReadyPr = createPullRequest({ id: 1, title: 'First ready PR', head_sha: 'abc' })
    const secondReadyPr = createPullRequest({ id: 2, title: 'Second ready PR', head_sha: 'def' })
    ticketPrs.set(new Map([[task.id, [firstReadyPr, secondReadyPr]]]))

    await runner.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([firstReadyPr, secondReadyPr])
    expect(get(error)).toBe('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
  })

  it('marks a single ready PR merged locally', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const readyPr = createPullRequest({ id: 9001, pr_number: 42 })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(mergePullRequest).mockResolvedValue(undefined)

    await runner.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).toHaveBeenCalledWith(task.id, readyPr.id, readyPr.head_sha, 'squash')
    expect(get(ticketPrs).get(task.id)?.[0].state).toBe('merged')
    expect(get(ticketPrs).get(task.id)?.[0].merged_at).not.toBeNull()
  })

  it('refreshes GitHub policy after a rejected merge without trying another method', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const readyPr = createPullRequest({ id: 9001, pr_number: 42 })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(mergePullRequest).mockRejectedValue(new Error('Merge commits are not allowed'))
    vi.mocked(refreshTaskGithubStatus).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
      outcome: 'completed',
    })

    await runner.mergeReadyPullRequest(task, 'merge')

    expect(mergePullRequest).toHaveBeenCalledOnce()
    expect(refreshTaskGithubStatus).toHaveBeenCalledWith(task.id)
    expect(get(error)).toContain('Merge commits are not allowed')
  })

  it('marks a single ready-to-enqueue PR queued locally', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const readyPr = createPullRequest({
      id: 9002,
      pr_number: 43,
      merge_readiness_status: 'ready_to_enqueue',
      merge_readiness_action: 'enqueue',
      readiness_source_head_sha: 'abc',
      readiness_updated_at: 0,
      merge_queue_required: true,
    })
    ticketPrs.set(new Map([[task.id, [readyPr]]]))
    vi.mocked(enqueuePullRequest).mockResolvedValue(undefined)

    await runner.enqueueReadyPullRequest(task)

    expect(enqueuePullRequest).toHaveBeenCalledWith(task.id, readyPr.id, readyPr.head_sha)
    expect(get(ticketPrs).get(task.id)?.[0]).toEqual(expect.objectContaining({
      is_queued: true,
      merge_readiness_status: 'queued_pull_request',
      merge_readiness_action: 'wait_for_queue',
    }))
  })

  it('does not enqueue a stale ready-to-enqueue PR', async () => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const stalePr = createPullRequest({
      head_sha: 'new-head',
      mergeable: null,
      mergeable_state: 'unknown',
      merge_readiness_status: 'ready_to_enqueue',
      merge_readiness_action: 'enqueue',
      readiness_source_head_sha: 'old-head',
      readiness_updated_at: 1,
    })
    ticketPrs.set(new Map([[task.id, [stalePr]]]))

    await runner.enqueueReadyPullRequest(task)

    expect(enqueuePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([stalePr])
  })

  it('deleteTaskAndReload reloads tasks after successful completion', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks,
    })

    await runner.deleteTaskAndReload(task.id)

    expect(deleteTask).toHaveBeenCalledWith(task.id)
    expect(loadTasks).toHaveBeenCalledOnce()
    expect(get(completingTasks).has(task.id)).toBe(false)
  })

  it('deleteTaskAndReload surfaces failures to the error store without reloading', async () => {
    const loadTasks = vi.fn(async () => undefined)
    vi.mocked(deleteTask).mockRejectedValue(new Error('delete blew up'))
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks,
    })

    await runner.deleteTaskAndReload(task.id)

    expect(get(error)).toContain('delete blew up')
    expect(loadTasks).not.toHaveBeenCalled()
    expect(get(completingTasks).has(task.id)).toBe(false)
  })

  it('deleteTaskAndReload skips a task that is already completing', async () => {
    const loadTasks = vi.fn(async () => undefined)
    completingTasks.set(new Set([task.id]))
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks,
    })

    await runner.deleteTaskAndReload(task.id)

    expect(deleteTask).not.toHaveBeenCalled()
    expect(loadTasks).not.toHaveBeenCalled()
  })

  it('sets a task aside optimistically, persists it, and then refreshes project attention', async () => {
    let resolveSave!: () => void
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    const loadProjectAttention = vi.fn(async () => undefined)
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['T-existing']))
    vi.mocked(setProjectConfig).mockImplementation(() => savePending)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      loadProjectAttention,
    })

    outOfFocusTaskIdsByProject.set(new Map([[activeProject.id, new Set(['stale-task'])]]))
    const mutation = runner.setTaskOutOfFocus(task.id, true)
    await vi.waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get(activeProject.id)).toEqual(new Set(['T-existing', task.id]))
    })

    expect(setProjectConfig).toHaveBeenCalledWith(activeProject.id, 'low_fire_task_ids', JSON.stringify(['T-existing', task.id]))
    expect(loadProjectAttention).not.toHaveBeenCalled()

    resolveSave()
    await mutation
    expect(loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('returns a task to the board by removing it from the Out of Focus backing set and refreshing project attention', async () => {
    const loadProjectAttention = vi.fn(async () => undefined)
    outOfFocusTaskIdsByProject.set(new Map([[activeProject.id, new Set(['T-existing', task.id])]]))
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['T-existing', task.id]))
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      loadProjectAttention,
    })

    await runner.setTaskOutOfFocus(task.id, false)

    expect(get(outOfFocusTaskIdsByProject).get(activeProject.id)).toEqual(new Set(['T-existing']))
    expect(setProjectConfig).toHaveBeenCalledWith(activeProject.id, 'low_fire_task_ids', JSON.stringify(['T-existing']))
    expect(loadProjectAttention).toHaveBeenCalledOnce()
  })

  it('keeps the optimistic Action Palette update and reports persistence failures consistently', async () => {
    const saveError = new Error('save failed')
    const loadProjectAttention = vi.fn(async () => undefined)
    const logError = vi.fn()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockRejectedValue(saveError)
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      loadProjectAttention,
      logError,
    })

    await runner.setTaskOutOfFocus(task.id, true)

    expect(get(outOfFocusTaskIdsByProject).get(activeProject.id)).toEqual(new Set([task.id]))
    expect(loadProjectAttention).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Failed to update Out of Focus tasks:', saveError)
    expect(get(error)).toContain('save failed')
  })

  it('does not let a pending FocusBoard load overwrite an Action Palette mutation', async () => {
    let resolveBoardLoad!: (taskIds: Set<string>) => void
    const boardLoad = new Promise<Set<string>>((resolve) => {
      resolveBoardLoad = resolve
    })
    let persistedTaskIds = new Set(['persisted-task'])
    const taskIdsByProject = writable<Map<string, Set<string>>>(new Map())
    const loadTaskIds = vi
      .fn<() => Promise<Set<string>>>()
      .mockImplementationOnce(() => boardLoad)
      .mockImplementation(async () => new Set(persistedTaskIds))
    const membership = createOutOfFocusTaskMembershipState({
      taskIdsByProject,
      loadTaskIds,
      saveTaskIds: vi.fn(async (_projectId, taskIds) => {
        persistedTaskIds = new Set(taskIds)
      }),
    })
    const controller = createOutOfFocusController({ membership })
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
      outOfFocusMembership: membership,
    })

    controller.selectProject(activeProject.id)
    await runner.setTaskOutOfFocus(task.id, true)
    resolveBoardLoad(new Set(['stale-task']))

    await vi.waitFor(() => expect(controller.isReadyFor(activeProject.id)).toBe(true))
    expect(get(taskIdsByProject).get(activeProject.id)).toEqual(new Set(['persisted-task', task.id]))
  })

  it.each([
    ['pending CI', { ci_status: 'pending', mergeable_state: 'clean' }],
    ['draft PR', { draft: true, mergeable_state: 'clean', ci_status: 'success' }],
    ['queued PR', { is_queued: true, mergeable_state: 'clean', ci_status: 'success' }],
    ['unknown mergeability', { mergeable: null, mergeable_state: 'unknown', ci_status: 'success' }],
    ['null mergeability', { mergeable: null, mergeable_state: null, ci_status: 'success' }],
  ] satisfies Array<[string, Partial<PullRequestInfo>]>)('does not merge a PR with %s', async (_label, overrides) => {
    const runner = createTaskActionRunner({
      getActiveProject: () => activeProject,
      loadTasks: vi.fn(async () => undefined),
    })
    const blockedPr = createPullRequest(overrides)
    ticketPrs.set(new Map([[task.id, [blockedPr]]]))

    await runner.mergeReadyPullRequest(task, 'squash')

    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(get(ticketPrs).get(task.id)).toEqual([blockedPr])
  })
})
