import type { Task, AgentSession, PullRequestInfo } from './types'
import type { TaskState } from './taskState'
import { computeTaskState, ALL_TASK_STATES } from './taskState'
import { getProjectConfig, setProjectConfig } from './ipc'

export type BoardFilter = 'focus' | 'low-fire' | 'backlog'

export const DEFAULT_FOCUS_STATES: TaskState[] = [
  'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
  'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
  'ready-to-merge', 'pr-merged', 'merge-conflict',
]

const LEGACY_DEFAULT_FOCUS_STATES: TaskState[] = [
  'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
  'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
  'ready-to-merge', 'pr-merged',
]

const FOCUS_FILTER_CONFIG_KEY = 'focus_filter_states'
const LOW_FIRE_TASK_IDS_CONFIG_KEY = 'low_fire_task_ids'

export const FOCUS_FILTER_STATES: TaskState[] = ALL_TASK_STATES.filter((state) => state !== 'active')

function removeNonFocusableStates(states: TaskState[]): TaskState[] {
  return states.filter((state) => FOCUS_FILTER_STATES.includes(state))
}

function isLegacyDefaultFocusStateSet(states: TaskState[]): boolean {
  return states.length === LEGACY_DEFAULT_FOCUS_STATES.length
    && LEGACY_DEFAULT_FOCUS_STATES.every((state, index) => states[index] === state)
}

export function isFocusTask(_task: Task, state: TaskState, prs: PullRequestInfo[], focusStates: TaskState[] = DEFAULT_FOCUS_STATES): boolean {
  if (state === 'done' || state === 'active') {
    return false
  }

  if (focusStates.includes(state)) {
    return true
  }

  return prs.some(pr => pr.unaddressed_comment_count > 0)
}

export function filterTasks(
  tasks: Task[],
  filter: BoardFilter,
  _sessions: Map<string, AgentSession>,
  _prs: Map<string, PullRequestInfo[]>,
  _focusStates: TaskState[] = DEFAULT_FOCUS_STATES,
  lowFireTaskIds: Set<string> = new Set()
): Task[] {
  if (filter === 'focus') {
    return tasks.filter(task => {
      if (task.status === 'done' || task.status === 'backlog') return false
      return !lowFireTaskIds.has(task.id)
    })
  }

  if (filter === 'low-fire') {
    return tasks.filter(task => {
      if (task.status === 'done' || task.status === 'backlog') return false
      return lowFireTaskIds.has(task.id)
    })
  }

  if (filter === 'backlog') {
    return tasks.filter(task => task.status === 'backlog')
  }

  return []
}

export function getFilterCounts(
  tasks: Task[],
  sessions: Map<string, AgentSession>,
  prs: Map<string, PullRequestInfo[]>,
  focusStates: TaskState[] = DEFAULT_FOCUS_STATES,
  lowFireTaskIds: Set<string> = new Set()
): Record<BoardFilter, number> {
  const counts: Record<BoardFilter, number> = {
    focus: 0,
    'low-fire': 0,
    backlog: 0,
  }

  for (const task of tasks) {
    if (task.status === 'backlog') {
      counts.backlog++
      continue
    }
    if (task.status === 'done') {
      continue
    }
    // task is doing — check if it's a focus task
    const session = sessions.get(task.id) ?? null
    const taskPrs = prs.get(task.id) ?? []
    const state = computeTaskState(task, session, taskPrs)
    if (!isFocusTask(task, state, taskPrs, focusStates)) {
      continue
    }
    if (lowFireTaskIds.has(task.id)) {
      counts['low-fire']++
    } else {
      counts.focus++
    }
  }

  return counts
}

export async function loadFocusFilterStates(projectId: string): Promise<TaskState[]> {
  const stored = await getProjectConfig(projectId, FOCUS_FILTER_CONFIG_KEY)
  if (!stored) return DEFAULT_FOCUS_STATES
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.every((s: string) => ALL_TASK_STATES.includes(s as TaskState))) {
      const parsedStates = parsed as TaskState[]
      if (isLegacyDefaultFocusStateSet(parsedStates)) {
        return DEFAULT_FOCUS_STATES
      }
      return removeNonFocusableStates(parsedStates)
    }
  } catch { /* ignore */ }
  return DEFAULT_FOCUS_STATES
}

export async function saveFocusFilterStates(projectId: string, states: TaskState[]): Promise<void> {
  await setProjectConfig(projectId, FOCUS_FILTER_CONFIG_KEY, JSON.stringify(removeNonFocusableStates(states)))
}

export async function loadLowFireTaskIds(projectId: string): Promise<Set<string>> {
  const stored = await getProjectConfig(projectId, LOW_FIRE_TASK_IDS_CONFIG_KEY)
  if (!stored) return new Set()
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.every((taskId: unknown) => typeof taskId === 'string')) {
      return new Set(parsed)
    }
  } catch { /* ignore */ }
  return new Set()
}

export async function saveLowFireTaskIds(projectId: string, taskIds: Set<string>): Promise<void> {
  await setProjectConfig(projectId, LOW_FIRE_TASK_IDS_CONFIG_KEY, JSON.stringify(Array.from(taskIds)))
}
