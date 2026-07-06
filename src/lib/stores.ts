import { writable, derived } from "svelte/store";
import type { Task, AgentSession, PullRequestInfo, Project, AgentEvent, CheckpointNotification, CiFailureNotification, RateLimitNotification, ReviewPullRequest, AuthoredPullRequest, PrFileDiff, AppView, ReviewComment, ReviewSubmissionComment, AgentReviewComment, PrOverviewComment, ProjectAttention } from "./types";
import type { BoardFilter } from './boardFilters'
import { buildReviewRequestCountByProject, countAllReposUnopenedReviews, countRepoUnopenedReviews } from './prReviewBadgeCounts'

export interface TaskRuntimeInfo {
  workspacePath: string;
}

export const tasks = writable<Task[]>([]);
// Completed tasks stay out of active board/search lists, but visible tasks can
// still resolve them as read-only dependency metadata for dependency chips.
export const dependencyReferenceTasks = writable<Task[]>([]);
export const pendingTask = writable<Task | null>(null);
// selectedTaskId serves as both selection state and navigation:
// - null = show Flow board
// - non-null = show full-page detail view for that task
export const selectedTaskId = writable<string | null>(null);
// The task to briefly highlight (a one-shot "pop") when the user returns to the
// board from its detail view. null = nothing to highlight.
export const lastViewedTaskId = writable<string | null>(null);
export const activeSessions = writable<Map<string, AgentSession>>(new Map());
export const checkpointNotification = writable<CheckpointNotification | null>(null);
export const ciFailureNotification = writable<CiFailureNotification | null>(null);
export const rateLimitNotification = writable<RateLimitNotification | null>(null);
export const taskSpawned = writable<{ taskId: string; promptText: string } | null>(null);
export const ticketPrs = writable<Map<string, PullRequestInfo[]>>(new Map());
export const mergingTaskIds = writable<Set<string>>(new Set());
export function setTaskMerging(taskId: string, isMerging: boolean): void {
  mergingTaskIds.update((current) => {
    const next = new Set(current);
    if (isMerging) {
      next.add(taskId);
    } else {
      next.delete(taskId);
    }
    return next;
  });
}
export const isLoading = writable(false);
export const error = writable<string | null>(null);
export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);
export const activeProjectColorId = writable<string | null>(null);
export const projectAttention = writable<Map<string, ProjectAttention>>(new Map());
// Sidebar per-project attention count (the green dot): distinct Focus-tab tasks needing
// attention, excluding in-flight (running) agents and Out of Focus tasks. Populated by the data
// orchestrator using the board's own getFilterCounts, so the dot matches the board's Focus
// count exactly. Keyed by project id; missing projects report zero.
export const attentionCountByProject = writable<Map<string, number>>(new Map());
export const agentEvents = writable<Map<string, AgentEvent[]>>(new Map());
export const taskRuntimeInfo = writable<Map<string, TaskRuntimeInfo>>(new Map());

export const currentView = writable<AppView>("board");
export const reviewPrs = writable<ReviewPullRequest[]>([]);
export const selectedReviewPr = writable<ReviewPullRequest | null>(null);
export const prFileDiffs = writable<PrFileDiff[]>([]);

// The active project's resolved GitHub repo ("owner/name"), or null when unresolved.
// Backs the per-repo rail badge scope; distinct from the all-repos sidebar badge.
export const activeResolvedRepo = writable<string | null>(null);
// Global repo-exclusion filter for the "All Pull Requests" view. Stored in global
// config (not per-project), so the sidebar badge is constant across project switches.
export const globalExcludedPrRepos = writable<ReadonlySet<string>>(new Set());

// "All Pull Requests" sidebar badge: unopened review requests across ALL repos, minus
// globally-excluded repos and "DO NOT REVIEW" PRs. Derived from reviewPrs so opening a
// PR (which mutates reviewPrs) drops the count immediately; independent of active project.
export const reviewRequestCount = derived(
  [reviewPrs, globalExcludedPrRepos],
  ([$reviewPrs, $excluded]) => countAllReposUnopenedReviews($reviewPrs, $excluded),
);
// Rail "Pull Requests" icon badge: same logic scoped to the active project's resolved
// repo. Zero when the repo is unresolved, so the rail never shows an all-repos number.
export const activeRepoReviewRequestCount = derived(
  [reviewPrs, activeResolvedRepo],
  ([$reviewPrs, $repo]) => countRepoUnopenedReviews($reviewPrs, $repo),
);
// Each project's resolved GitHub repo ("owner/name" or null), keyed by project id. Populated
// by the data orchestrator; backs the sidebar's per-project review-request badge so a project
// can show its own count without being the active one.
export const projectResolvedRepos = writable<Map<string, string | null>>(new Map());
// Sidebar per-project review badge: unopened review requests scoped to each project's resolved
// repo. Same unopened / "do not review" rule as the rail badge, so opening a PR drops the owning
// project's count immediately. Keyed by project id; missing/unresolved projects report zero.
export const reviewRequestCountByProject = derived(
  [reviewPrs, projectResolvedRepos],
  ([$reviewPrs, $repos]) => buildReviewRequestCountByProject($reviewPrs, $repos),
);
export const reviewComments = writable<ReviewComment[]>([]);
export const pendingManualComments = writable<ReviewSubmissionComment[]>([]);
export const prOverviewComments = writable<PrOverviewComment[]>([]);

export const agentReviewComments = writable<AgentReviewComment[]>([]);

/** Set of task IDs currently starting (worktree creation + agent spawn in progress) */
export const startingTasks = writable<Set<string>>(new Set());

/** Set of task IDs with a Complete (delete) in flight, awaiting the backend. */
export const completingTasks = writable<Set<string>>(new Set());

export const codeCleanupTasksEnabled = writable<boolean>(false);

/** Per-task active view identifier preserved across navigation. */
export const taskActiveView = writable<Map<string, string>>(new Map());

/** Per-task draft note text — preserved across navigation */
export const taskDraftNotes = writable<Map<string, string>>(new Map());

export const focusBoardFilters = writable<Map<string, BoardFilter>>(new Map())
export const outOfFocusTaskIdsByProject = writable<Map<string, Set<string>>>(new Map())

function createBacklogLabelFilters() {
  const store = writable<Map<string, Set<number>>>(new Map())
  let previousProjectId: string | null | undefined = undefined

  activeProjectId.subscribe((projectId) => {
    if (previousProjectId !== undefined && projectId !== previousProjectId) {
      store.set(new Map())
    }
    previousProjectId = projectId
  })

  return store
}

export const backlogLabelFilters = createBacklogLabelFilters()

export const authoredPrs = writable<AuthoredPullRequest[]>([]);
export const commandHeld = writable<boolean>(false);
