import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveTasks, Project, TaskDetail } from './types'

const ipc = vi.hoisted(() => ({
  getAppMode: vi.fn(),
  getConfig: vi.fn(),
  getProjectConfig: vi.fn(),
  getReviewPrs: vi.fn(),
  forceGithubSync: vi.fn(),
  getLatestSessions: vi.fn(),
  getProjectAttention: vi.fn(),
  getProjectTaskLabels: vi.fn(),
  getProjects: vi.fn(),
  getPullRequests: vi.fn(),
  getTaskAttention: vi.fn(),
}))

const taskState = vi.hoisted(() => ({
  clearActiveTasks: vi.fn(),
  getActiveTasksForProject: vi.fn(),
  projectTaskLabelsByProject: { update: vi.fn() },
  pruneTaskProjects: vi.fn(),
  refreshActiveTasks: vi.fn(),
  setVisibleTaskContext: vi.fn(),
}))

vi.mock('./ipc', () => ipc)
vi.mock('./tasksState', async (importOriginal) => ({
  ...await importOriginal<typeof import('./tasksState')>(),
  ...taskState,
}))

import { useAppDataOrchestrator } from './appDataOrchestrator.svelte'
import {
  activeProjectId,
  activeSessions,
  error,
  isLoading,
  projects,
  ticketPrs,
  selectedTaskId,
  taskAttentionRows,
} from './stores'

const project: Project = {
  id: 'project-1',
  name: 'Project',
  path: '/project',
  created_at: 1,
  updated_at: 1,
}

const detail: TaskDetail = {
  id: 'task-1',
  projectId: project.id,
  status: 'doing',
  title: 'Task',
  prompt: 'Prompt',
  promptPreview: 'Prompt',
  dependsOn: [],
  createdAt: 1,
  updatedAt: 2,
  labels: [],
  sourceTicketUrl: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  titleSource: null,
  titleGeneratedAt: null,
}

const active: ActiveTasks = { tasks: [detail], related: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function createOrchestrator() {
  return useAppDataOrchestrator({
    setShowProjectSetup: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  taskState.refreshActiveTasks.mockReset()
  taskState.getActiveTasksForProject.mockReset()
  projects.set([])
  activeProjectId.set(null)
  selectedTaskId.set(null)
  activeSessions.set(new Map())
  ticketPrs.set(new Map())
  taskAttentionRows.set([])
  isLoading.set(false)
  error.set(null)

  ipc.getConfig.mockResolvedValue(null)
  ipc.getProjectConfig.mockResolvedValue(null)
  ipc.getReviewPrs.mockResolvedValue([])
  ipc.forceGithubSync.mockResolvedValue({})
  ipc.getProjects.mockResolvedValue([project])
  ipc.getLatestSessions.mockResolvedValue([])
  ipc.getPullRequests.mockResolvedValue([])
  ipc.getTaskAttention.mockResolvedValue([])
  ipc.getProjectAttention.mockResolvedValue([])
  ipc.getProjectTaskLabels.mockResolvedValue([])
  ipc.getAppMode.mockResolvedValue('prod')
  taskState.refreshActiveTasks.mockResolvedValue(active)
  taskState.getActiveTasksForProject.mockReturnValue(null)
})

describe('app data orchestration', () => {
  it('clears active Task state when no project is selected', async () => {
    const orchestrator = createOrchestrator()

    await orchestrator.loadTasks()

    expect(taskState.clearActiveTasks).toHaveBeenCalledOnce()
    expect(taskState.refreshActiveTasks).not.toHaveBeenCalled()
  })

  it('loads one canonical active read for the selected project', async () => {
    activeProjectId.set(project.id)
    const orchestrator = createOrchestrator()

    await orchestrator.loadTasks()

    expect(taskState.refreshActiveTasks).toHaveBeenCalledWith(
      project.id,
      undefined,
      expect.any(Function),
    )
    expect(taskState.setVisibleTaskContext).toHaveBeenCalledWith(project.id, null)
  })

  it('coalesces a burst into one active read plus one trailing refresh', async () => {
    activeProjectId.set(project.id)
    const first = deferred<ActiveTasks>()
    taskState.refreshActiveTasks
      .mockImplementationOnce(async () => first.promise)
      .mockResolvedValueOnce(active)
    const orchestrator = createOrchestrator()

    const firstLoad = orchestrator.loadTasks()
    await vi.waitFor(() => expect(taskState.refreshActiveTasks).toHaveBeenCalledOnce())
    const coalescedLoad = orchestrator.loadTasks()
    first.resolve(active)
    await Promise.all([firstLoad, coalescedLoad])

    expect(taskState.refreshActiveTasks).toHaveBeenCalledTimes(2)
  })

  it('rejects an active response after the selected project changes', async () => {
    activeProjectId.set(project.id)
    let accept: (() => boolean) | undefined
    taskState.refreshActiveTasks.mockImplementation(async (_projectId, _load, nextAccept) => {
      accept = nextAccept
      return active
    })
    const orchestrator = createOrchestrator()

    await orchestrator.loadTasks()
    activeProjectId.set('project-2')

    expect(accept?.()).toBe(false)
  })


  it('prunes removed project Task state after loading projects', async () => {
    projects.set([{ ...project, id: 'removed-project' }])
    const orchestrator = createOrchestrator()

    await orchestrator.loadProjects()

    expect(taskState.pruneTaskProjects).toHaveBeenCalledWith(new Set([project.id]))
  })

})
