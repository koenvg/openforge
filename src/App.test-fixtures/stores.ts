import { derived, writable } from 'svelte/store'
import { vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from '../lib/githubSyncPlugin'
import { FILE_VIEWER_VIEW_KEY } from '../lib/fileViewerView'
import { makePluginViewKey } from '../lib/plugin/types'
import { countAllReposUnopenedReviews, countRepoUnopenedReviews } from '../lib/prReviewBadgeCounts'
import type {
  AgentSession,
  CheckpointNotification,
  CiFailureNotification,
  Project,
  ProjectAttention,
  PullRequestInfo,
  RateLimitNotification,
  TaskDetail,
  TaskReference,
} from '../lib/types'

const TASK_SCHEDULES_VIEW_KEY = makePluginViewKey('com.openforge.task-schedules', 'schedules')

export const mockSelectedTaskIdStore = writable<string | null>(null)
export const mockActiveProjectIdStore = writable<string | null>(null)
export const mockMergingTaskIdsStore = writable<Set<string>>(new Set())
export const mockTaskDetailsByIdStore = writable<Map<string, TaskDetail>>(new Map())
export const mockTasksStore = writable<TaskDetail[]>([])
export const mockDependencyReferenceTasksStore = writable<TaskReference[]>([])

export function setMockTasks(items: TaskDetail[]): void {
  mockTasksStore.set(items)
}
export const mockCurrentViewStore = writable<
  | 'board'
  | 'files'
  | 'settings'
  | 'global_settings'
  | typeof FILE_VIEWER_VIEW_KEY
  | typeof GITHUB_SYNC_VIEW_KEY
  | typeof TASK_SCHEDULES_VIEW_KEY
>('board')
export const mockSelectedReviewPrStore = writable(null)

vi.mock('../lib/stores', () => {
  const reviewPrs = writable<any[]>([])
  const activeResolvedRepo = writable<string | null>(null)
  const globalExcludedPrRepos = writable<ReadonlySet<string>>(new Set())
  const projectResolvedRepos = writable<Map<string, string | null>>(new Map())
  const attentionCountByProject = writable<Map<string, number>>(new Map())

  const tasks = mockTasksStore
  const dependencyReferenceTasks = mockDependencyReferenceTasksStore
  return {
    tasks,
    taskDetailsById: mockTaskDetailsByIdStore,
    dependencyReferenceTasks,
    pendingTask: writable<TaskDetail | null>(null),
    selectedTaskId: mockSelectedTaskIdStore,
    activeSessions: writable<Map<string, AgentSession>>(new Map()),
    checkpointNotification: writable<CheckpointNotification | null>(null),
    ciFailureNotification: writable<CiFailureNotification | null>(null),
    rateLimitNotification: writable<RateLimitNotification | null>(null),
    taskSpawned: writable<{ taskId: string; promptText: string } | null>(null),
    ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
    mergingTaskIds: mockMergingTaskIdsStore,
    setTaskMerging: vi.fn((taskId: string, isMerging: boolean) => {
      mockMergingTaskIdsStore.update((current) => {
        const next = new Set(current)
        if (isMerging) {
          next.add(taskId)
        } else {
          next.delete(taskId)
        }
        return next
      })
    }),
    isLoading: writable(false),
    error: writable<string | null>(null),
    projects: writable<Project[]>([]),
    hiddenProjectIds: writable<Set<string>>(new Set()),
    activeProjectId: mockActiveProjectIdStore,
    projectAttention: writable<Map<string, ProjectAttention>>(new Map()),
    taskAttentionRows: writable([]),
    taskAttentionLoaded: writable(false),
    attentionCountByProject,
    activeProjectAttentionCount: derived(
      [attentionCountByProject, mockActiveProjectIdStore],
      ([$counts, $projectId]) => ($projectId ? ($counts.get($projectId) ?? 0) : 0),
    ),
    agentEvents: writable<Map<string, any>>(new Map()),
    taskRuntimeInfo: writable(new Map()),
    currentView: mockCurrentViewStore,
    sidebarPluginViewKeys: writable<ReadonlySet<string>>(new Set()),
    reviewPrs,
    activeResolvedRepo,
    globalExcludedPrRepos,
    projectResolvedRepos,
    selectedReviewPr: mockSelectedReviewPrStore,
    prFileDiffs: writable([]),
    reviewRequestCount: derived(
      [reviewPrs, globalExcludedPrRepos],
      ([$prs, $excluded]) => countAllReposUnopenedReviews($prs, $excluded),
    ),
    activeRepoReviewRequestCount: derived(
      [reviewPrs, activeResolvedRepo],
      ([$prs, $repo]) => countRepoUnopenedReviews($prs, $repo),
    ),
    reviewComments: writable([]),
    pendingManualComments: writable([]),
    selectedReviewPrDetails: writable(null),
    reviewPullRequestDiff: writable(null),
    commandHeld: writable(false),
    focusBoardFilters: writable(new Map()),
    outOfFocusTaskIdsByProject: writable(new Map()),
    startingTasks: writable<Set<string>>(new Set()),
  }
})

vi.mock('../lib/tasksState', () => ({
  activeTasks: mockTasksStore,
  taskDetailsById: mockTaskDetailsByIdStore,
  dependencyReferenceTasks: mockDependencyReferenceTasksStore,
  updateTaskDetail: vi.fn((taskId: string, update: (task: TaskDetail) => TaskDetail) => {
    mockTaskDetailsByIdStore.update((current) => {
      const detail = current.get(taskId)
      return detail ? new Map(current).set(taskId, update(detail)) : current
    })
  }),
  activateCachedTaskDetail: vi.fn((projectId: string, taskId: string) => {
    let detail: TaskDetail | null = null
    mockTaskDetailsByIdStore.subscribe((current) => {
      const candidate = current.get(taskId)
      detail = candidate?.projectId === projectId ? candidate : null
    })()
    return detail
  }),
  loadTaskDetail: vi.fn(async (projectId: string, taskId: string, load?: (projectId: string, taskId: string) => Promise<import('../lib/types').TaskRead | null>) => {
    const loader = load ?? (await import('../lib/ipc')).readTaskDetail
    const result = await loader(projectId, taskId)
    if (result) mockTaskDetailsByIdStore.update((current) => new Map(current).set(taskId, result.task))
    return result
  }),
  refreshActiveTasks: vi.fn(async (projectId: string, load?: (projectId: string) => Promise<import('../lib/types').ActiveTasks>, accept: () => boolean = () => true) => {
    const loader = load ?? (await import('../lib/ipc')).readActiveTasks
    const result = await loader(projectId)
    if (!accept()) return null
    mockTasksStore.set(result.tasks)
    mockTaskDetailsByIdStore.set(new Map(result.tasks.map((task) => [task.id, task])))
    mockDependencyReferenceTasksStore.set(result.related)
    return result
  }),
  getActiveTasksForProject: vi.fn((projectId: string) => {
    let activeProjectId: string | null = null
    mockActiveProjectIdStore.subscribe((value) => { activeProjectId = value })()
    if (activeProjectId !== projectId) return null
    let activeTasks: TaskDetail[] = []
    mockTasksStore.subscribe((value) => { activeTasks = value })()
    return { tasks: activeTasks, related: [] }
  }),
  clearActiveTasks: vi.fn(() => {
    mockTasksStore.set([])
    mockTaskDetailsByIdStore.set(new Map())
    mockDependencyReferenceTasksStore.set([])
  }),
  pruneTaskProjects: vi.fn(),
  evictTask: vi.fn((taskId: string) => {
    mockTasksStore.update((current) => current.filter((task) => task.id !== taskId))
    mockTaskDetailsByIdStore.update((current) => {
      const next = new Map(current)
      next.delete(taskId)
      return next
    })
  }),
  getVisibleRelationshipOwner: vi.fn(() => null),
  setVisibleTaskContext: vi.fn(),
}))

export function resetStoreFixtures() {
  mockActiveProjectIdStore.set(null)
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockTaskDetailsByIdStore.set(new Map())
  mockTasksStore.set([])
  mockDependencyReferenceTasksStore.set([])
  mockSelectedReviewPrStore.set(null)
}
