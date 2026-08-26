import { derived, writable } from 'svelte/store'
import { vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from '../lib/githubSyncPlugin'
import { countAllReposUnopenedReviews, countRepoUnopenedReviews } from '../lib/prReviewBadgeCounts'
import type {
  AgentSession,
  CheckpointNotification,
  CiFailureNotification,
  Project,
  ProjectAttention,
  PullRequestInfo,
  RateLimitNotification,
  Task,
} from '../lib/types'

export const mockSelectedTaskIdStore = writable<string | null>(null)
export const mockActiveProjectIdStore = writable<string | null>(null)
export const mockMergingTaskIdsStore = writable<Set<string>>(new Set())
export const mockCurrentViewStore = writable<
  | 'board'
  | 'files'
  | 'settings'
  | 'global_settings'
  | 'plugin:com.openforge.file-viewer:files'
  | typeof GITHUB_SYNC_VIEW_KEY
  | 'plugin:com.openforge.task-schedules:schedules'
>('board')
export const mockSelectedReviewPrStore = writable(null)

vi.mock('../lib/stores', () => {
  const reviewPrs = writable<any[]>([])
  const activeResolvedRepo = writable<string | null>(null)
  const globalExcludedPrRepos = writable<ReadonlySet<string>>(new Set())
  const projectResolvedRepos = writable<Map<string, string | null>>(new Map())
  const attentionCountByProject = writable<Map<string, number>>(new Map())

  return {
    tasks: writable<Task[]>([]),
    dependencyReferenceTasks: writable<Task[]>([]),
    pendingTask: writable<Task | null>(null),
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
    codeCleanupTasksEnabled: writable(false),
  }
})

export function resetStoreFixtures() {
  mockActiveProjectIdStore.set(null)
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockSelectedReviewPrStore.set(null)
}
