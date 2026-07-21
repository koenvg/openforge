import { getAppShortcutHelpLabel, getPrimaryAppShortcutKey } from './appShortcutDefinitions'
import { getMergeReadiness } from './types'
import type { PullRequestInfo, Task } from './types'

export interface PaletteAction {
  id: string
  label: string
  shortcut: string | null
  category: 'task' | 'navigation' | 'general'
  keywords: string[]
}

export interface TaskActionCapabilities {
  canRunApp: boolean
}

const DEFAULT_TASK_ACTION_CAPABILITIES: TaskActionCapabilities = {
  canRunApp: false,
}

export function getTaskActions(
  task: Task,
  taskPrs: PullRequestInfo[] = [],
  outOfFocusTaskIds: Set<string> = new Set(),
  capabilities: TaskActionCapabilities = DEFAULT_TASK_ACTION_CAPABILITIES,
): PaletteAction[] {
  const actions: PaletteAction[] = []

  if (task.status === 'backlog') {
    actions.push({
      id: 'start-task',
      label: 'Start Task',
      shortcut: null,
      category: 'task',
      keywords: ['run', 'execute', 'begin', 'agent'],
    })
  }


  const readyToMergePrs = taskPrs.filter((pr) => {
    const readiness = getMergeReadiness(pr)
    return readiness.status === 'ready_to_merge' && readiness.action === 'merge'
  })
  if (readyToMergePrs.length === 1) {
    actions.push({
      id: 'merge-pr',
      label: 'Merge Pull Request',
      shortcut: null,
      category: 'task',
      keywords: ['merge', 'pull request', 'pr', 'github'],
    })
  }

  const readyToEnqueuePrs = taskPrs.filter((pr) => {
    const readiness = getMergeReadiness(pr)
    return readiness.status === 'ready_to_enqueue' && readiness.action === 'enqueue'
  })
  if (readyToEnqueuePrs.length === 1) {
    actions.push({
      id: 'enqueue-pr',
      label: 'Enqueue Pull Request',
      shortcut: null,
      category: 'task',
      keywords: ['enqueue', 'merge queue', 'pull request', 'pr', 'github'],
    })
  }

  if (task.status === 'doing' && outOfFocusTaskIds.has(task.id)) {
    actions.push({
      id: 'return-to-board',
      label: 'Move task back in focus',
      shortcut: null,
      category: 'task',
      keywords: ['focus', 'board', 'move', 'out of focus'],
    })
  }

  actions.push({
    id: 'delete-task',
    label: task.status === 'backlog' ? 'Delete' : 'Complete',
    shortcut: null,
    category: 'task',
    keywords: ['remove', 'trash', 'complete', 'finish', 'close', 'done'],
  })

  if (task.status === 'doing' && !outOfFocusTaskIds.has(task.id)) {
    actions.push({
      id: 'set-aside-task',
      label: 'Set aside',
      shortcut: null,
      category: 'task',
      keywords: ['set aside', 'out of focus', 'hide', 'defer'],
    })
  }

  if (capabilities.canRunApp) {
    actions.push({
      id: 'run-app',
      label: 'Run app',
      shortcut: null,
      category: 'task',
      keywords: ['run', 'app', 'local', 'terminal', 'serve', 'dev'],
    })
  }

  return actions
}

interface GlobalActionDefinition {
  id: string
  category: PaletteAction['category']
  keywords: string[]
}

const GLOBAL_ACTION_DEFINITIONS: readonly GlobalActionDefinition[] = [
  { id: 'go-back', category: 'navigation', keywords: ['back', 'previous', 'navigate'] },
  { id: 'search-tasks', category: 'general', keywords: ['find', 'search', 'lookup'] },
  { id: 'new-task', category: 'general', keywords: ['create', 'add', 'task'] },
  { id: 'switch-project', category: 'navigation', keywords: ['project', 'switch', 'change'] },
  { id: 'refresh-github', category: 'general', keywords: ['sync', 'github', 'refresh', 'pull'] },
]

function getShortcutBackedGlobalAction(definition: GlobalActionDefinition): PaletteAction {
  const label = getAppShortcutHelpLabel(definition.id)
  if (!label) {
    throw new Error(`Missing app shortcut help label for global action ${definition.id}`)
  }

  return {
    id: definition.id,
    label,
    shortcut: getPrimaryAppShortcutKey(definition.id),
    category: definition.category,
    keywords: definition.keywords,
  }
}

export function getGlobalActions(): PaletteAction[] {
  return GLOBAL_ACTION_DEFINITIONS.map(getShortcutBackedGlobalAction)
}

export function getAvailableActions(
  task: Task | null,
  taskPrs: PullRequestInfo[] = [],
  outOfFocusTaskIds: Set<string> = new Set(),
  capabilities: TaskActionCapabilities = DEFAULT_TASK_ACTION_CAPABILITIES,
): PaletteAction[] {
  const taskActions = task ? getTaskActions(task, taskPrs, outOfFocusTaskIds, capabilities) : []
  return [...taskActions, ...getGlobalActions()]
}

export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const q = query.trim().toLowerCase()
  if (!q) return actions
  return actions.filter(a =>
    a.label.toLowerCase().includes(q) ||
    a.keywords.some(k => k.toLowerCase().includes(q))
  )
}
