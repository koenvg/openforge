import type { Project, ReviewPullRequest, Task, TaskAttentionRow, TaskLaneRows } from './types'
import type { TaskState } from './taskState'
import type { BoardFilter } from './boardFilters'
import { isUnopened } from './prReviewBadgeCounts'

/** The board lanes, in the order the overview cycles through them. */
export const TASK_LANES: readonly BoardFilter[] = ['focus', 'in-flight', 'out-of-focus', 'backlog']

export const TASK_LANE_LABELS: Record<BoardFilter, string> = {
  focus: 'Focus',
  'in-flight': 'In Flight',
  'out-of-focus': 'Out of Focus',
  backlog: 'Backlog',
}

/** Rows per lane, keyed the way the renderer names lanes rather than the way the backend does. */
export type LaneRows = Record<BoardFilter, TaskAttentionRow[]>

export function laneRowsByFilter(rows: TaskLaneRows): LaneRows {
  return {
    focus: rows.focus,
    'in-flight': rows.in_flight,
    'out-of-focus': rows.out_of_focus,
    backlog: rows.backlog,
  }
}

export function emptyLaneRows(): LaneRows {
  return { focus: [], 'in-flight': [], 'out-of-focus': [], backlog: [] }
}

/** A backend-projected task row joined to the full desktop Task record used for navigation. */
export interface AttentionFocusTask {
  task: Task
  state: TaskState
  title: string
  reason: string
  /**
   * The task's last recorded state change. For a running agent that is the moment it started
   * running, which is what lets the In Flight lane show how long a task has been flying.
   */
  activityAt: number
}

/** One project's slice of the overview: its four task lanes and its owed review PRs. */
export interface AttentionProjectGroup {
  project: Project
  /** One list per board lane. The dialog shows exactly one lane at a time. */
  tasksByLane: Record<BoardFilter, AttentionFocusTask[]>
  reviewPrs: ReviewPullRequest[]
}

export interface AttentionOverview {
  /** Projects in sidebar order, limited to those with at least one item. */
  groups: AttentionProjectGroup[]
  /** Owed review PRs whose repo maps to no local project. */
  otherReviewPrs: ReviewPullRequest[]
  totalTasksByLane: Record<BoardFilter, number>
  totalReviewPrs: number
  /**
   * Agents running right now, across every lane and project. Independent of which lane the
   * dialog is showing: the focus lane deliberately excludes running agents, so a count taken
   * from one lane would report zero while agents were working.
   */
  totalRunningAgents: number
}

export interface BuildAttentionOverviewInput {
  /** Projects in sidebar order. */
  projects: Project[]
  /** Full desktop Task records used only to open selected backend-projected rows. */
  allTasks: Task[]
  /**
   * Backend-authoritative Task-only lane projection. The lanes are disjoint: a Task appears
   * in exactly one of them.
   */
  taskRowsByLane: LaneRows
  /** All review-requested PRs (cross-repo), kept on their standalone path. */
  reviewPrs: ReviewPullRequest[]
  /** Globally excluded repos ("owner/name"). */
  excludedRepos: ReadonlySet<string>
  /** Resolved repo ("owner/name" | null) per project id. */
  resolvedRepoByProject: Map<string, string | null>
  /**
   * Project ids the user has hidden from the sidebar. Hidden projects produce no group,
   * and a review PR whose repo is owned only by hidden project(s) is dropped entirely
   * (not surfaced under "Other repositories"). Defaults to empty.
   */
  hiddenProjectIds?: ReadonlySet<string>
}

function prRepoKey(pr: ReviewPullRequest): string {
  return `${pr.repo_owner}/${pr.repo_name}`
}

function buildLaneTasks(
  project: Project,
  tasksById: ReadonlyMap<string, Task>,
  rows: TaskAttentionRow[],
): AttentionFocusTask[] {
  return rows
    .filter((row) => row.project_id === project.id)
    .flatMap((row) => {
      const task = tasksById.get(row.task_id)
      if (!task) return []
      return [{
        task,
        state: row.state,
        title: row.title,
        reason: row.reason,
        activityAt: row.activity_at,
      }]
    })
}

/**
 * Assemble the desktop overview from the backend-owned Task projection and the existing
 * standalone pull-request review path. Project order and hidden-project behavior remain
 * desktop concerns; Task membership, lane, state, reason, title, and activity order do not.
 */
export function buildAttentionOverview(input: BuildAttentionOverviewInput): AttentionOverview {
  const hiddenProjectIds = input.hiddenProjectIds ?? new Set<string>()
  const tasksById = new Map(input.allTasks.map((task) => [task.id, task]))

  // Map each resolved repo to the first VISIBLE project (in sidebar order) that owns it,
  // so a repo shared by several projects surfaces its PRs exactly once. Track every repo
  // owned by any project (visible or hidden) so we can tell "owned only by a hidden
  // project" (drop the PR) apart from "no local project at all" (surface under Other).
  const repoToProjectId = new Map<string, string>()
  const allProjectRepos = new Set<string>()
  for (const project of input.projects) {
    const repo = input.resolvedRepoByProject.get(project.id)
    if (!repo) continue
    allProjectRepos.add(repo)
    if (!hiddenProjectIds.has(project.id) && !repoToProjectId.has(repo)) {
      repoToProjectId.set(repo, project.id)
    }
  }

  const reviewsByProject = new Map<string, ReviewPullRequest[]>()
  const otherReviewPrs: ReviewPullRequest[] = []
  const owedReviews = input.reviewPrs
    .filter((pr) => isUnopened(pr) && !input.excludedRepos.has(prRepoKey(pr)))
    .slice()
    .sort((a, b) => b.updated_at - a.updated_at)

  for (const pr of owedReviews) {
    const repo = prRepoKey(pr)
    const projectId = repoToProjectId.get(repo)
    if (projectId) {
      const list = reviewsByProject.get(projectId) ?? []
      list.push(pr)
      reviewsByProject.set(projectId, list)
    } else if (allProjectRepos.has(repo)) {
      continue
    } else {
      otherReviewPrs.push(pr)
    }
  }

  const groups: AttentionProjectGroup[] = []
  const totalTasksByLane: Record<BoardFilter, number> = {
    focus: 0,
    'in-flight': 0,
    'out-of-focus': 0,
    backlog: 0,
  }
  let totalReviewPrs = otherReviewPrs.length
  let totalRunningAgents = 0

  for (const project of input.projects) {
    if (hiddenProjectIds.has(project.id)) continue
    const tasksByLane = {} as Record<BoardFilter, AttentionFocusTask[]>
    let taskCount = 0
    for (const lane of TASK_LANES) {
      const laneTasks = buildLaneTasks(project, tasksById, input.taskRowsByLane[lane])
      tasksByLane[lane] = laneTasks
      totalTasksByLane[lane] += laneTasks.length
      taskCount += laneTasks.length
      totalRunningAgents += laneTasks.filter((item) => item.state === 'active').length
    }
    const reviewPrs = reviewsByProject.get(project.id) ?? []
    if (taskCount === 0 && reviewPrs.length === 0) continue

    groups.push({ project, tasksByLane, reviewPrs })
    totalReviewPrs += reviewPrs.length
  }

  return { groups, otherReviewPrs, totalTasksByLane, totalReviewPrs, totalRunningAgents }
}
