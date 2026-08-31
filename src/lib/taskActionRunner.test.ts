import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Project, Task } from './types'

vi.mock('./ipc', () => ({
  deleteTask: vi.fn(),
  enqueuePullRequest: vi.fn(),
  getProjectConfig: vi.fn(),
  getSessionStatus: vi.fn(),
  inspectExistingBranch: vi.fn(),
  mergePullRequest: vi.fn(),
  refreshTaskGithubStatus: vi.fn(),
  setProjectConfig: vi.fn(),
  startImplementation: vi.fn(),
}))

vi.mock('./ptySubmit', () => ({
  writePtyWithSubmit: vi.fn(),
}))

vi.mock('./terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue({ shellSessionKey: 'T-1' }),
  beginPtySpawn: vi.fn(() => null),
  focusTerminal: vi.fn(),
  hasTerminal: vi.fn(() => false),
  isPtyActive: vi.fn(() => false),
  release: vi.fn(),
}))

import { createOutOfFocusController } from '../components/focus-board/outOfFocusController.svelte'
import { createOutOfFocusTaskMembershipState } from './outOfFocusTaskMembership'
import { createTaskActionRunner } from './taskActionRunner'
import { getProjectConfig, setProjectConfig } from './ipc'
import { error, outOfFocusTaskIdsByProject } from './stores'

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

describe('createTaskActionRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    error.set(null)
    outOfFocusTaskIdsByProject.set(new Map())
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
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
})
