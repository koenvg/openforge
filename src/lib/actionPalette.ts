import { getAppShortcutHelpLabel, getPrimaryAppShortcutKey } from './appShortcutDefinitions'
import {
  getProjectActionPresentation,
  getTaskActionPresentation,
  TASK_ACTION_PRESENTATION,
} from './actionPalettePresentation'
import { getMergeReadiness } from './types'
import type {
  ActionPaletteIcon,
  ActionPresentationMetadata,
  TaskPaletteActionId,
} from './actionPalettePresentation'
import type { PullRequestInfo, Task } from './types'

export interface PaletteAction extends ActionPresentationMetadata {
  id: string
  shortcut: string | null
  category: 'task' | 'navigation' | 'general'
}

export interface TaskActionCapabilities {
  canRunApp: boolean
}

const DEFAULT_TASK_ACTION_CAPABILITIES: TaskActionCapabilities = {
  canRunApp: false,
}

function taskPaletteAction(id: TaskPaletteActionId): PaletteAction {
  return {
    id,
    shortcut: null,
    category: 'task',
    ...getTaskActionPresentation(id),
  }
}

export function getTaskActions(
  task: Task,
  taskPrs: PullRequestInfo[] = [],
  outOfFocusTaskIds: Set<string> = new Set(),
  capabilities: TaskActionCapabilities = DEFAULT_TASK_ACTION_CAPABILITIES,
): PaletteAction[] {
  const availableActionIds = new Set<TaskPaletteActionId>()

  if (task.status === 'backlog') {
    availableActionIds.add('start-task')
  }

  const readyToMergePrs = taskPrs.filter((pr) => {
    const readiness = getMergeReadiness(pr)
    return readiness.status === 'ready_to_merge' && readiness.action === 'merge'
  })
  if (readyToMergePrs.length === 1) {
    availableActionIds.add('merge-pr')
  }

  const readyToEnqueuePrs = taskPrs.filter((pr) => {
    const readiness = getMergeReadiness(pr)
    return readiness.status === 'ready_to_enqueue' && readiness.action === 'enqueue'
  })
  if (readyToEnqueuePrs.length === 1) {
    availableActionIds.add('enqueue-pr')
  }

  const isOutOfFocus = task.status === 'doing' && outOfFocusTaskIds.has(task.id)
  if (isOutOfFocus) {
    availableActionIds.add('return-to-board')
  }

  availableActionIds.add(task.status === 'backlog' ? 'delete-task' : 'complete-task')

  if (task.status === 'doing' && !isOutOfFocus) {
    availableActionIds.add('set-aside-task')
  }

  if (capabilities.canRunApp) {
    availableActionIds.add('run-app')
  }

  return [...TASK_ACTION_PRESENTATION.keys()]
    .filter((id) => availableActionIds.has(id))
    .map(taskPaletteAction)
}

interface GlobalActionDefinition extends ActionPresentationMetadata {
  id: string
  category: PaletteAction['category']
}

function localGlobalAction(
  id: string,
  category: PaletteAction['category'],
  keywords: readonly string[],
  icon: ActionPaletteIcon,
): GlobalActionDefinition {
  return {
    id,
    category,
    label: '',
    keywords,
    icon,
    requiresConfirmation: false,
    destructive: false,
  }
}

const GLOBAL_ACTION_DEFINITIONS: readonly GlobalActionDefinition[] = [
  localGlobalAction('go-back', 'navigation', ['back', 'previous', 'navigate'], 'arrow_back'),
  localGlobalAction('search-tasks', 'general', ['find', 'search', 'lookup'], 'search'),
  localGlobalAction('new-task', 'general', ['create', 'add', 'task'], 'add'),
  localGlobalAction('switch-project', 'navigation', ['project', 'switch', 'change'], 'switch'),
  {
    id: 'refresh-github',
    category: 'general',
    ...getProjectActionPresentation('refresh-github'),
  },
]

function getShortcutBackedGlobalAction(definition: GlobalActionDefinition): PaletteAction {
  const label = getAppShortcutHelpLabel(definition.id)
  if (!label) {
    throw new Error(`Missing app shortcut help label for global action ${definition.id}`)
  }

  return {
    ...definition,
    label,
    shortcut: getPrimaryAppShortcutKey(definition.id),
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
