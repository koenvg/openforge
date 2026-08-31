import type { TaskDetail } from './types'
import type { TaskState } from './taskState'
import { getProjectConfig, setProjectConfig } from './ipc'
import { getTaskLabels } from './taskLabels'

export type BoardFilter = 'focus' | 'in-flight' | 'out-of-focus' | 'backlog'

export const DEFAULT_FOCUS_STATES: TaskState[] = [
  'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
  'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
  'ready-to-merge', 'ready-to-enqueue', 'pr-merged', 'pr-closed', 'merge-conflict',
]

const LEGACY_DEFAULT_FOCUS_STATE_SETS: TaskState[][] = [
  [
    'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
    'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
    'ready-to-merge', 'pr-merged',
  ],
  [
    'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
    'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
    'ready-to-merge', 'pr-merged', 'merge-conflict',
  ],
  [
    'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
    'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
    'ready-to-merge', 'pr-merged', 'pr-closed', 'merge-conflict',
  ],
]

const FOCUS_FILTER_CONFIG_KEY = 'focus_filter_states'
const OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY = 'low_fire_task_ids'

export const FOCUS_FILTER_STATES: TaskState[] = [
  'idle',
  'needs-input',
  'paused',
  'agent-done',
  'failed',
  'interrupted',
  'pr-draft',
  'pr-open',
  'ci-running',
  'review-pending',
  'ci-failed',
  'changes-requested',
  'unaddressed-comments',
  'ready-to-merge',
  'ready-to-enqueue',
  'pr-queued',
  'pr-merged',
  'pr-closed',
  'merge-conflict',
]

function removeNonFocusableStates(states: TaskState[]): TaskState[] {
  return states.filter((state) => FOCUS_FILTER_STATES.includes(state))
}

function isLegacyDefaultFocusStateSet(states: TaskState[]): boolean {
  return LEGACY_DEFAULT_FOCUS_STATE_SETS.some((legacyStates) =>
    states.length === legacyStates.length
      && legacyStates.every((state, index) => states[index] === state),
  )
}

export function taskMatchesTextFilter(task: TaskDetail, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true

  return [
    task.title,
    task.prompt,
    ...getTaskLabels(task).map((label) => label.name),
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
}

/**
 * Partition Tasks using the backend-authoritative attention membership. The renderer still
 * owns the non-attention lanes, but it no longer derives whether a Task needs user action.
 */
export function filterTasks(
  tasks: TaskDetail[],
  filter: BoardFilter,
  attentionTaskIds: ReadonlySet<string>,
  outOfFocusTaskIds: ReadonlySet<string> = new Set(),
): TaskDetail[] {
  if (filter === 'backlog') {
    return tasks.filter((task) => task.status === 'backlog')
  }

  return tasks.filter((task) => {
    if (task.status !== 'doing') return false

    const isManuallyOutOfFocus = outOfFocusTaskIds.has(task.id)
    if (filter === 'out-of-focus') return isManuallyOutOfFocus
    if (isManuallyOutOfFocus) return false
    if (filter === 'focus') return attentionTaskIds.has(task.id)
    if (filter === 'in-flight') return !attentionTaskIds.has(task.id)
    return false
  })
}

export function getFilterCounts(
  tasks: TaskDetail[],
  attentionTaskIds: ReadonlySet<string>,
  outOfFocusTaskIds: ReadonlySet<string> = new Set(),
): Record<BoardFilter, number> {
  const counts: Record<BoardFilter, number> = {
    focus: 0,
    'in-flight': 0,
    'out-of-focus': 0,
    backlog: 0,
  }

  for (const task of tasks) {
    if (task.status === 'backlog') {
      counts.backlog++
      continue
    }
    if (task.status !== 'doing') continue
    if (outOfFocusTaskIds.has(task.id)) {
      counts['out-of-focus']++
    } else if (attentionTaskIds.has(task.id)) {
      counts.focus++
    } else {
      counts['in-flight']++
    }
  }

  return counts
}

export async function loadFocusFilterStates(projectId: string): Promise<TaskState[]> {
  const stored = await getProjectConfig(projectId, FOCUS_FILTER_CONFIG_KEY)
  if (!stored) return DEFAULT_FOCUS_STATES
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.every((state: string) => FOCUS_FILTER_STATES.includes(state as TaskState) || state === 'active')) {
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

export async function loadOutOfFocusTaskIds(projectId: string): Promise<Set<string>> {
  const stored = await getProjectConfig(projectId, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY)
  if (!stored) return new Set()
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.every((taskId: unknown) => typeof taskId === 'string')) {
      return new Set(parsed)
    }
  } catch { /* ignore */ }
  return new Set()
}

export async function saveOutOfFocusTaskIds(projectId: string, taskIds: Set<string>): Promise<void> {
  await setProjectConfig(projectId, OUT_OF_FOCUS_TASK_IDS_CONFIG_KEY, JSON.stringify(Array.from(taskIds)))
}
