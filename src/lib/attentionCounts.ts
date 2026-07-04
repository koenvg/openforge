import type { Task, AgentSession, PullRequestInfo } from './types'
import type { TaskState } from './taskState'
import { DEFAULT_FOCUS_STATES, getFilterCounts } from './boardFilters'

/**
 * Per-project count of Focus-tab tasks needing attention, keyed by project id. Reuses the
 * board's `getFilterCounts` so the sidebar green dot is the exact same number the board shows
 * on its Focus tab — distinct tasks, excluding in-flight (running) agents and low-fire tasks.
 *
 * This replaces the old sidebar behaviour of summing heterogeneous backend signals
 * (completed agents + CI failures + per-comment counts), which double-counted tasks and
 * counted each PR comment separately, inflating the number well past the board's count.
 *
 * `focusStatesByProject` / `lowFireByProject` mirror each project's saved board config; a
 * project missing from either map falls back to the defaults, matching the board.
 */
export function buildAttentionCountByProject(
  tasks: Task[],
  sessions: Map<string, AgentSession>,
  prs: Map<string, PullRequestInfo[]>,
  focusStatesByProject: Map<string, TaskState[]>,
  lowFireByProject: Map<string, Set<string>>,
): Map<string, number> {
  const tasksByProject = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.project_id) continue
    const projectTasks = tasksByProject.get(task.project_id) ?? []
    projectTasks.push(task)
    tasksByProject.set(task.project_id, projectTasks)
  }

  const counts = new Map<string, number>()
  for (const [projectId, projectTasks] of tasksByProject) {
    const focusStates = focusStatesByProject.get(projectId) ?? DEFAULT_FOCUS_STATES
    const lowFire = lowFireByProject.get(projectId) ?? new Set<string>()
    counts.set(projectId, getFilterCounts(projectTasks, sessions, prs, focusStates, lowFire).focus)
  }
  return counts
}
