import type { Project, ReviewPullRequest, Task, TaskAttentionRow } from './types'
import type { TaskState } from './taskState'
import { isUnopened } from './prReviewBadgeCounts'

/** A backend-projected task row joined to the full desktop Task record used for navigation. */
export interface AttentionFocusTask {
  task: Task
  state: TaskState
  title: string
  reason: string
}

/** One project's slice of the overview: its task lanes and its owed review PRs. */
export interface AttentionProjectGroup {
  project: Project
  focusTasks: AttentionFocusTask[]
  /** Tasks the user parked in the project's Out of Focus lane. */
  setAsideTasks: AttentionFocusTask[]
  reviewPrs: ReviewPullRequest[]
}

export interface AttentionOverview {
  /** Projects in sidebar order, limited to those with at least one item. */
  groups: AttentionProjectGroup[]
  /** Owed review PRs whose repo maps to no local project. */
  otherReviewPrs: ReviewPullRequest[]
  totalFocusTasks: number
  totalSetAsideTasks: number
  totalReviewPrs: number
}

export interface BuildAttentionOverviewInput {
  /** Projects in sidebar order. */
  projects: Project[]
  /** Full desktop Task records used only to open selected backend-projected rows. */
  allTasks: Task[]
  /** Backend-authoritative Task-only Needs Attention projection. */
  taskAttentionRows: TaskAttentionRow[]
  /**
   * Backend-authoritative set-aside ("Out of Focus") projection, in the same row shape.
   * Disjoint from `taskAttentionRows`: a parked Task never appears in both. Defaults to empty.
   */
  setAsideTaskRows?: TaskAttentionRow[]
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

function buildFocusTasks(
  project: Project,
  tasksById: ReadonlyMap<string, Task>,
  taskAttentionRows: TaskAttentionRow[],
): AttentionFocusTask[] {
  return taskAttentionRows
    .filter((row) => row.project_id === project.id)
    .flatMap((row) => {
      const task = tasksById.get(row.task_id)
      if (!task) return []
      return [{
        task,
        state: row.state,
        title: row.title,
        reason: row.reason,
      }]
    })
}

/**
 * Assemble the desktop overview from the backend-owned Task projection and the existing
 * standalone pull-request review path. Project order and hidden-project behavior remain
 * desktop concerns; Task membership, state, reason, title, and activity order do not.
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
  let totalFocusTasks = 0
  let totalSetAsideTasks = 0
  let totalReviewPrs = otherReviewPrs.length

  for (const project of input.projects) {
    if (hiddenProjectIds.has(project.id)) continue
    const focusTasks = buildFocusTasks(project, tasksById, input.taskAttentionRows)
    const setAsideTasks = buildFocusTasks(project, tasksById, input.setAsideTaskRows ?? [])
    const reviewPrs = reviewsByProject.get(project.id) ?? []
    if (focusTasks.length === 0 && setAsideTasks.length === 0 && reviewPrs.length === 0) continue

    groups.push({ project, focusTasks, setAsideTasks, reviewPrs })
    totalFocusTasks += focusTasks.length
    totalSetAsideTasks += setAsideTasks.length
    totalReviewPrs += reviewPrs.length
  }

  return { groups, otherReviewPrs, totalFocusTasks, totalSetAsideTasks, totalReviewPrs }
}
