import type { AgentSession, Project, PullRequestInfo, ReviewPullRequest, Task } from './types'
import type { TaskState } from './taskState'
import { computeTaskState } from './taskState'
import { isFocusTask, DEFAULT_FOCUS_STATES } from './boardFilters'
import { isUnopened } from './prReviewBadgeCounts'

/** A single focus-column task, enriched with the state that drives its row. */
export interface AttentionFocusTask {
  task: Task
  state: TaskState
  session: AgentSession | null
  prs: PullRequestInfo[]
  /** True when the task needs the user to act (idle, needs-input, PR-ready, …) vs an agent that is actively in-flight. */
  needsAttention: boolean
}

/** One project's slice of the overview: its focus tasks and its owed review PRs. */
export interface AttentionProjectGroup {
  project: Project
  focusTasks: AttentionFocusTask[]
  reviewPrs: ReviewPullRequest[]
}

export interface AttentionOverview {
  /** Projects in sidebar order, limited to those with at least one item. */
  groups: AttentionProjectGroup[]
  /** Owed review PRs whose repo maps to no local project. */
  otherReviewPrs: ReviewPullRequest[]
  totalFocusTasks: number
  totalReviewPrs: number
}

export interface BuildAttentionOverviewInput {
  /** Projects in sidebar order. */
  projects: Project[]
  /** Tasks across every project. */
  allTasks: Task[]
  /** Latest session per task id. */
  sessions: Map<string, AgentSession>
  /** Task-linked PRs per task id (drives task state). */
  ticketPrs: Map<string, PullRequestInfo[]>
  /** Low-fire task ids per project id. */
  lowFireByProject: Map<string, Set<string>>
  /** Configured focus states per project id; falls back to the defaults when absent. */
  focusStatesByProject: Map<string, TaskState[]>
  /** All review-requested PRs (cross-repo). */
  reviewPrs: ReviewPullRequest[]
  /** Globally excluded repos ("owner/name"). */
  excludedRepos: ReadonlySet<string>
  /** Resolved repo ("owner/name" | null) per project id. */
  resolvedRepoByProject: Map<string, string | null>
}

function prRepoKey(pr: ReviewPullRequest): string {
  return `${pr.repo_owner}/${pr.repo_name}`
}

function activityTime(task: Task, session: AgentSession | null): number {
  return session?.updated_at ?? task.updated_at
}

/**
 * Build the focus tasks for one project: its `doing`, non-low-fire tasks — the
 * Focus column as the board defines it — ordered needs-attention first, then by
 * recent activity.
 */
function buildFocusTasks(
  project: Project,
  input: BuildAttentionOverviewInput,
): AttentionFocusTask[] {
  const lowFire = input.lowFireByProject.get(project.id) ?? new Set<string>()
  const focusStates = input.focusStatesByProject.get(project.id) ?? DEFAULT_FOCUS_STATES

  const items = input.allTasks
    .filter((task) => task.project_id === project.id && task.status === 'doing' && !lowFire.has(task.id))
    .map((task) => {
      const session = input.sessions.get(task.id) ?? null
      const prs = input.ticketPrs.get(task.id) ?? []
      const state = computeTaskState(task, session, prs)
      return {
        task,
        state,
        session,
        prs,
        needsAttention: isFocusTask(task, state, prs, focusStates),
      }
    })

  items.sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1
    return activityTime(b.task, b.session) - activityTime(a.task, a.session)
  })

  return items
}

/**
 * Aggregate, across all projects, the two things that need the user's attention:
 * focus-column tasks and unwatched review-requested PRs. Projects keep sidebar
 * order; empty projects are dropped; review PRs with no local project land in
 * `otherReviewPrs`.
 */
export function buildAttentionOverview(input: BuildAttentionOverviewInput): AttentionOverview {
  // Map each resolved repo to the first project (in sidebar order) that owns it,
  // so a repo shared by several projects surfaces its PRs exactly once.
  const repoToProjectId = new Map<string, string>()
  for (const project of input.projects) {
    const repo = input.resolvedRepoByProject.get(project.id)
    if (repo && !repoToProjectId.has(repo)) {
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
    const projectId = repoToProjectId.get(prRepoKey(pr))
    if (projectId) {
      const list = reviewsByProject.get(projectId) ?? []
      list.push(pr)
      reviewsByProject.set(projectId, list)
    } else {
      otherReviewPrs.push(pr)
    }
  }

  const groups: AttentionProjectGroup[] = []
  let totalFocusTasks = 0
  let totalReviewPrs = otherReviewPrs.length

  for (const project of input.projects) {
    const focusTasks = buildFocusTasks(project, input)
    const reviewPrs = reviewsByProject.get(project.id) ?? []
    if (focusTasks.length === 0 && reviewPrs.length === 0) continue

    groups.push({ project, focusTasks, reviewPrs })
    totalFocusTasks += focusTasks.length
    totalReviewPrs += reviewPrs.length
  }

  return { groups, otherReviewPrs, totalFocusTasks, totalReviewPrs }
}
